
const $ = (id) => document.getElementById(id);

const fileInput = $("videoFile");
const sourceVideo = $("sourceVideo");
const exportBtn = $("exportBtn");

let sourceFile = null;
let sourceUrl = null;
let resultUrl = null;
let ffmpeg = null;
let ffmpegLoadPromise = null;
let isExporting = false;

function say(message, isError = false) {
  const status = $("statusMessage");
  if (!status) return;

  status.textContent = message;
  status.style.color = isError ? "#ff9292" : "";
}

function setProgress(value, message) {
  const bar = $("progressBar");
  const text = $("progressText");

  if (bar) {
    bar.value = Math.max(0, Math.min(100, value));
  }

  if (text) text.textContent = message;
}

function showError(prefix, error) {
  console.error(prefix, error);

  const message =
    error?.message ||
    error?.toString?.() ||
    "Erreur inconnue";

  say(prefix + " : " + message, true);
}

function useVideo(file) {
  if (!file) return;

  if (!file.type.startsWith("video/")) {
    say("Choisis un fichier vidéo valide.", true);
    return;
  }

  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  if (resultUrl) URL.revokeObjectURL(resultUrl);

  sourceFile = file;
  sourceUrl = URL.createObjectURL(file);
  resultUrl = null;

  sourceVideo.src = sourceUrl;
  sourceVideo.hidden = false;
  $("resultPanel").hidden = true;

  $("fileMeta").textContent =
    file.name + " — " +
    (file.size / 1048576).toFixed(1) + " MB";

  sourceVideo.onloadedmetadata = () => {
    const duration = sourceVideo.duration;

    if (!Number.isFinite(duration) || duration <= 0) {
      say("Impossible de lire la durée de cette vidéo.", true);
      exportBtn.disabled = true;
      return;
    }

    $("startTime").max = String(duration);
    $("endTime").max = String(duration);
    $("startTime").value = "0";
    $("endTime").value = String(Math.min(3, duration));

    exportBtn.disabled = false;

    say(
      "Vidéo chargée (" +
      duration.toFixed(1) +
      " secondes). Choisis ton passage."
    );
  };

  sourceVideo.onerror = () => {
    say(
      "Le navigateur ne parvient pas à lire cette vidéo. Essaie un fichier MP4.",
      true
    );
  };
}

fileInput.addEventListener("change", (event) => {
  useVideo(event.target.files?.[0]);
});

async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    say("Chargement du moteur vidéo…");
    setProgress(0, "Chargement du moteur vidéo…");

    const packageURL =
      "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm";

    const coreURLBase =
      "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";

    const { FFmpeg } = await import(
      packageURL + "/index.js"
    );

    const { toBlobURL } = await import(
      "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js"
    );

    const engine = new FFmpeg();

    engine.on("log", ({ message }) => {
      console.log("[FFmpeg]", message);
    });

    engine.on("progress", ({ progress }) => {
      const percent = Math.round(
        Math.max(0, Math.min(1, progress)) * 100
      );

      setProgress(percent, "Encodage : " + percent + "%");
    });

    say("Chargement du worker local…");

    // Le worker est hébergé sur le même domaine que Clipzer.
    // Fichier requis : assets/ffmpeg/worker.js
    const classWorkerURL = new URL(
      "./ffmpeg/worker.js",
      import.meta.url
    ).href;

    say("Préparation des composants vidéo…");

    // Le moteur et le WASM sont chargés depuis le CDN.
    const coreURL = await toBlobURL(
      coreURLBase + "/ffmpeg-core.js",
      "text/javascript"
    );

    const wasmURL = await toBlobURL(
      coreURLBase + "/ffmpeg-core.wasm",
      "application/wasm"
    );

    await engine.load({
      classWorkerURL,
      coreURL,
      wasmURL
    });

    ffmpeg = engine;
    say("Moteur vidéo prêt.");

    return engine;
  })();

  try {
    return await ffmpegLoadPromise;
  } catch (error) {
    ffmpegLoadPromise = null;
    ffmpeg = null;
    throw error;
  }
}

exportBtn.addEventListener("click", async () => {
  if (!sourceFile || isExporting) return;

  const start = Number($("startTime").value);
  const end = Number($("endTime").value);
  const duration = sourceVideo.duration;

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start
  ) {
    say("Vérifie le début et la fin du clip.", true);
    return;
  }

  if (Number.isFinite(duration) && end > duration + 0.05) {
    say("La fin du clip dépasse la durée de la vidéo.", true);
    return;
  }

  const selectedFormat = document.querySelector(
    'input[name="format"]:checked'
  );

  if (!selectedFormat) {
    say("Choisis un format vidéo.", true);
    return;
  }

  isExporting = true;
  exportBtn.disabled = true;
  $("progressArea").hidden = false;
  $("resultPanel").hidden = true;
  setProgress(0, "Préparation…");

  let engine;
  let inputName;
  let outputName;

  try {
    engine = await loadFFmpeg();

    const id =
      Date.now().toString() +
      "_" +
      Math.random().toString(36).slice(2, 8);

    inputName = "clipzer_input_" + id + ".mp4";
    outputName = "clipzer_output_" + id + ".mp4";

    say("Lecture du fichier vidéo…");

    const fileBytes = new Uint8Array(
      await sourceFile.arrayBuffer()
    );

    await engine.writeFile(inputName, fileBytes);

    const args = [
      "-y",
      "-ss", String(start),
      "-i", inputName,
      "-t", String(end - start),
      "-map", "0:v:0",
      "-map", "0:a:0?",
      "-sn",
      "-dn"
    ];

    if (selectedFormat.value === "vertical") {
      args.push(
        "-vf",
        "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280"
      );
    }

    args.push(
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "26",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-threads", "1",
      "-movflags", "+faststart",
      outputName
    );

    say("Export MP4 en cours. Garde cette page ouverte…");
    setProgress(0, "Démarrage de l’encodage…");

    const exitCode = await engine.exec(args);

    if (exitCode !== 0) {
      throw new Error(
        "FFmpeg a terminé avec le code " + exitCode
      );
    }

    say("Préparation du fichier MP4…");

    const output = await engine.readFile(outputName);

    if (!output || output.length === 0) {
      throw new Error("Le fichier MP4 généré est vide.");
    }

    if (resultUrl) URL.revokeObjectURL(resultUrl);

    const outputCopy = new Uint8Array(output.length);
    outputCopy.set(output);

    resultUrl = URL.createObjectURL(
      new Blob([outputCopy], { type: "video/mp4" })
    );

    $("resultVideo").src = resultUrl;
    $("downloadBtn").href = resultUrl;
    $("downloadBtn").download = "clipzer.mp4";
    $("resultPanel").hidden = false;

    setProgress(100, "Export terminé : 100 %");
    say("Ton clip MP4 est prêt !");

    $("resultPanel").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

  } catch (error) {
    showError("Échec de l’export", error);

    setProgress(
      0,
      "Échec de l’export. Consulte le message affiché."
    );

    console.error(
      "Détails de l’erreur Clipzer :",
      error?.stack || error
    );

  } finally {
    if (engine && inputName) {
      try {
        await engine.deleteFile(inputName);
      } catch (error) {
        console.warn("Nettoyage du fichier source :", error);
      }
    }

    if (engine && outputName) {
      try {
        await engine.deleteFile(outputName);
      } catch (error) {
        console.warn("Nettoyage du fichier exporté :", error);
      }
    }

    isExporting = false;
    exportBtn.disabled = !sourceFile;
  }
});

window.addEventListener("beforeunload", () => {
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  if (resultUrl) URL.revokeObjectURL(resultUrl);
});
