export const ERROR_UNKNOWN_MESSAGE_TYPE = new Error("type de message inconnu");
export const ERROR_NOT_LOADED = new Error("ffmpeg n'est pas chargé, appelez d'abord `await ffmpeg.load()`");
export const ERROR_TERMINATED = new Error("appel de FFmpeg.terminate()");
export const ERROR_IMPORT_FAILURE = new Error("échec de l'importation de ffmpeg-core.js");
