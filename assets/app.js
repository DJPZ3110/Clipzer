const $ = (id) => document.getElementById(id);

const fileInput = $("videoFile");
const sourceVideo = $("sourceVideo");
const exportBtn = $("exportBtn");

let sourceFile = null;
let sourceUrl = null;
let resultUrl = null;
let ffmpeg = null;

function say(message, error = false) {
const status = $("statusMessage");
status.textContent = message;
status.style.color = error ? "#ff9292" : "";
}

function useVideo(file) {
if (!file || !file.type.startsWith("video/")) {
say("Choisis un fichier vidéo valide.", true);
return;
}

sourceFile = file;

if (sourceUrl) URL.revokeObjectURL(sourceUrl);
sourceUrl = URL.createObjectURL(file);

sourceVideo.src = sourceUrl;
sourceVideo.hidden = false;

$("fileMeta").textContent =
file.name + " — " + (file.size / 1048576).toFixed(1) + " MB";

exportBtn.disabled = false;
$("resultPanel").hidden = true;

sourceVideo.onloadedmetadata = () => {
$("startTime").max = sourceVideo.duration;
$("endTime").max = sourceVideo.duration;
$("endTime").value = Math.min(30, Math.floor(sourceVideo.duration));
};

say("Vidéo chargée. Choisis le passage à exporter.");
}

fileInput.addEventListener("change", (event) => {
useVideo(event.target.files[0]);
});

async function loadFFmpeg() {
if (ffmpeg) return ffmpeg;

say("Chargement du moteur vidéo. La première utilisation peut être longue…");

const { FFmpeg } = await import(
"https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js"
);

const { toBlobURL } = await import(
"https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js"
);

ffmpeg = new FFmpeg();

ffmpeg.on("progress", ({ progress }) => {
const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
$("progressBar").value = percent;
$("progressText").textContent = "Encodage : " + percent + "%";
});

const base = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

const coreURL = await toBlobURL(
base + "/ffmpeg-core.js",
"text/javascript"
);

const wasmURL = await toBlobURL(
base + "/ffmpeg-core.wasm",
"application/wasm"
);

await ffmpeg.load({ coreURL, wasmURL });

return ffmpeg;
}

exportBtn.addEventListener("click", async () => {
if (!sourceFile) return;

const start = Number($("startTime").value);
const end = Number($("endTime").value);

if (
!Number.isFinite(start) ||
!Number.isFinite(end) ||
start < 0 ||
end <= start
) {
say("La fin doit être supérieure au début.", true);
return;
}

if (Number.isFinite(sourceVideo.duration) && end > sourceVideo.duration) {
say("La fin dépasse la durée de la vidéo.", true);
return;
}

exportBtn.disabled = true;
$("progressArea").hidden = false;
$("progressBar").value = 0;
$("resultPanel").hidden = true;

try {
const engine = await loadFFmpeg();

say("Préparation de la vidéo…");

const inputName = "clipzer_input";
const outputName = "clipzer_output.mp4";

await engine.writeFile(
  inputName,
  new Uint8Array(await sourceFile.arrayBuffer())
);

const args = [
  "-ss", String(start),
  "-i", inputName,
  "-t", String(end - start),
  "-map", "0:v:0",
  "-map", "0:a?",
  "-c:v", "libx264",
  "-preset", "ultrafast",
  "-crf", "26",
  "-c:a", "aac",
  "-b:a", "128k"
];

const format = document.querySelector(
  'input[name="format"]:checked'
).value;

if (format === "vertical") {
  args.push(
    "-vf",
    "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280"
  );
}

args.push("-movflags", "+faststart", outputName);

say("Export en cours. Garde cette page ouverte…");

await engine.exec(args);

const output = await engine.readFile(outputName);

if (resultUrl) URL.revokeObjectURL(resultUrl);

resultUrl = URL.createObjectURL(
  new Blob([output], { type: "video/mp4" })
);

$("resultVideo").src = resultUrl;
$("downloadBtn").href = resultUrl;
$("resultPanel").hidden = false;
$("progressBar").value = 100;

say("Export terminé ! Ton clip MP4 est prêt.");

$("resultPanel").scrollIntoView({
  behavior: "smooth",
  block: "start"
});

try {
  await engine.deleteFile(inputName);
  await engine.deleteFile(outputName);
} catch (cleanupError) {
  // Le résultat reste disponible même si le nettoyage échoue.
}

} catch (error) {
  console.error("Erreur Clipzer :", error);

  const detail = error?.message || String(error);

  say(
    "Échec de l’export : " + detail,
    true
  );
} finally {
  exportBtn.disabled = !sourceFile;
}

window.addEventListener("beforeunload", () => {
if (sourceUrl) URL.revokeObjectURL(sourceUrl);
if (resultUrl) URL.revokeObjectURL(resultUrl);
});
