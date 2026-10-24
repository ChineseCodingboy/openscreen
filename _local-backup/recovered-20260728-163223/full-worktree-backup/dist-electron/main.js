import D, { unlink as Ln } from "node:fs/promises";
import b, { join as Tr } from "node:path";
import { pathToFileURL as Ge, fileURLToPath as wr } from "node:url";
import { systemPreferences as ue, screen as K, app as V, ipcMain as F, desktopCapturer as bt, dialog as De, shell as Pt, safeStorage as Ie, globalShortcut as sr, BrowserWindow as Ke, nativeImage as $n, session as Gt, Menu as ir, Tray as Gn } from "electron";
import { spawn as Ve } from "node:child_process";
import { randomUUID as cr, createHash as pn } from "node:crypto";
import { EventEmitter as Hn } from "node:events";
import { accessSync as Kn, constants as wt, existsSync as Yn, createWriteStream as Jn, createReadStream as Xn } from "node:fs";
import { createServer as qn } from "node:http";
import Tt from "node:os";
const xr = 1e-3;
function xt(e) {
  return typeof e == "number" && Number.isFinite(e);
}
function Zn(e) {
  if (!e || typeof e != "object") return null;
  const t = e;
  return !xt(t.screenStartMs) || !xt(t.screenEndMs) || !xt(t.webcamStartMs) || !xt(t.webcamEndMs) || t.screenStartMs < 0 || t.webcamStartMs < 0 || t.screenEndMs - t.screenStartMs < xr || t.webcamEndMs - t.webcamStartMs < xr ? null : {
    screenStartMs: t.screenStartMs,
    screenEndMs: t.screenEndMs,
    webcamStartMs: t.webcamStartMs,
    webcamEndMs: t.webcamEndMs
  };
}
function lr(e) {
  if (!e || typeof e != "object") return;
  const t = e;
  if (t.schemaVersion !== 1 && t.version !== 1 || !Array.isArray(t.segments)) return;
  const r = t.segments.map(Zn).filter((a) => a !== null).sort((a, i) => a.screenStartMs - i.screenStartMs), n = [];
  for (const a of r) {
    const i = n.at(-1);
    i && (a.screenStartMs < i.screenEndMs || a.webcamStartMs < i.webcamEndMs) || n.push(a);
  }
  return n.length > 0 ? { schemaVersion: 1, segments: n } : void 0;
}
function Le(e) {
  return e === "editable-overlay" || e === "system" ? e : void 0;
}
function Qn(e) {
  if (!Array.isArray(e))
    return;
  const t = [];
  for (const r of e)
    (r === "system" || r === "microphone") && !t.includes(r) && t.push(r);
  return t.length > 0 ? t : void 0;
}
function mn(e) {
  if (!Array.isArray(e)) return;
  const t = /* @__PURE__ */ new Map();
  for (const n of e) {
    if (!n || typeof n != "object") continue;
    const a = n;
    if (typeof a.ordinal != "number" || !Number.isFinite(a.ordinal) || !eo(a.role)) continue;
    const i = Math.max(0, Math.round(a.ordinal));
    t.has(i) || t.set(i, { ordinal: i, role: a.role });
  }
  const r = [...t.values()].sort((n, a) => n.ordinal - a.ordinal);
  return r.length > 0 ? r : void 0;
}
function eo(e) {
  return e === "system" || e === "microphone" || e === "mixed" || e === "unknown" || e === "voiceover";
}
function Cr(e) {
  if (typeof e != "string")
    return;
  const t = e.trim();
  return t || void 0;
}
function fn(e) {
  if (!e || typeof e != "object")
    return null;
  const t = e, r = Cr(t.screenVideoPath);
  if (!r)
    return null;
  const n = Cr(t.webcamVideoPath), a = n ? lr(t.webcamSync) : void 0, i = Le(t.cursorCaptureMode), p = mn(t.audioTracks), h = Qn(t.audioStreams), m = p ?? (h?.length === 1 ? h.map((w, C) => ({ ordinal: C, role: w })) : void 0);
  return {
    screenVideoPath: r,
    ...n ? { webcamVideoPath: n } : {},
    ...a ? { webcamSync: a } : {},
    ...i ? { cursorCaptureMode: i } : {},
    ...m ? { audioTracks: m } : {},
    // Retain v4 requested-source metadata until the renderer has inspected the
    // physical file; two requested sources may be one mixed track or two tracks.
    ...h && !p ? { audioStreams: h } : {}
  };
}
function hn(e) {
  if (!e || typeof e != "object")
    return null;
  const t = e, r = fn(t);
  return r ? {
    ...r,
    createdAt: typeof t.createdAt == "number" && Number.isFinite(t.createdAt) ? t.createdAt : Date.now()
  } : null;
}
const to = { cancel: "الغاء", save: "حفظ", delete: "حذف", close: "اغلاق", share: "مشاركة", done: "تم", open: "فتح", upload: "رفع", export: "تصدير", showInFolder: "عرض في المجلد", file: "ملف", edit: "تعديل", view: "عرض", window: "نافذة", quit: "خروج", stopRecording: "إيقاف التسجيل", undo: "تراجع", redo: "إعادة", cut: "قص", copy: "نسخ", paste: "لصق", selectAll: "تحديد الكل", minimize: "تصغير", reload: "إعادة تحميل", forceReload: "إعادة تحميل إجبارية", toggleDevTools: "أدوات المطور", actualSize: "الحجم الفعلي", zoomIn: "تكبير", zoomOut: "تصغير", toggleFullScreen: "ملء الشاشة", recordingStatus: "جاري التسجيل: {{source}}", about: "حول OpenScreen", services: "خدمات", hide: "إخفاء OpenScreen", hideOthers: "إخفاء الآخرين", unhide: "إظهار الكل" }, ro = { play: "تشغيل", pause: "ايقاف مؤقت", fullscreen: "ملء الشاشة", exitFullscreen: "خروج من ملء الشاشة" }, no = { name: "عربي", short: "AR" }, oo = {
  actions: to,
  playback: ro,
  locale: no
}, ao = { triggerLabel: "كيف يعمل القص", title: "كيف يعمل القص", description: "فهم كيفية قص الأجزاء غير المرغوب فيها من الفيديو الخاص بك.", explanationBefore: "تعمل أداة القص من خلال تحديد المقاطع التي تريد", remove: "إزالتها", explanationMiddle: " — أي شيء", covered: "مغطى", explanationAfter: "بمقطع قص أحمر سيتم قصه عند التصدير.", visualExample: "مثال مرئي", removed: "مُزال", kept: "مُحتفظ به", part1: "الجزء 1", part2: "الجزء 2", part3: "الجزء 3", finalVideo: "الفيديو النهائي", step1Title: "1. إضافة قص", step1DescriptionBefore: "اضغط على ", step1DescriptionAfter: " أو انقر على أيقونة المقص لتحديد قسم لإزالته.", step2Title: "2. تعديل", step2Description: "اسحب حواف المنطقة الحمراء لتغطي بالضبط ما تريد قصه." }, so = { title: "تغييرات غير محفوظة", message: "لديك تغييرات غير محفوظة.", detail: "هل تريد حفظ مشروعك قبل الإغلاق؟", saveAndClose: "حفظ وإغلاق", discardAndClose: "تجاهل وإغلاق", detailNewProject: "هل تريد حفظ مشروعك قبل إنشاء مشروع جديد؟", saveAndNewProject: "حفظ وإنشاء مشروع جديد", discardAndNewProject: "تجاهل وإنشاء مشروع جديد", detailLoadProject: "هل تريد حفظ مشروعك قبل تحميل مشروع آخر؟", saveAndLoadProject: "حفظ وتحميل مشروع", discardAndLoadProject: "تجاهل وتحميل مشروع", loadProject: "تحميل مشروع...", saveProject: "حفظ المشروع...", saveProjectAs: "حفظ المشروع باسم...", newProject: "مشروع جديد", importVideo: "استيراد ملف فيديو…" }, io = { saveGif: "حفظ GIF المصدر", saveVideo: "حفظ الفيديو المصدر", selectVideo: "حدد ملف فيديو", saveProject: "حفظ مشروع OpenScreen", openProject: "فتح مشروع OpenScreen", gifImage: "صورة GIF", mp4Video: "فيديو MP4", videoFiles: "ملفات فيديو", openscreenProject: "مشروع OpenScreen", allFiles: "جميع الملفات" }, co = {
  export: { complete: "اكتمل التصدير", yourFormatReady: "{{format}} الخاص بك جاهز", showInFolder: "عرض في المجلد", finalizingVideo: "جاري إنهاء تصدير الفيديو...", compilingGifProgress: "جاري تجميع GIF... {{progress}}%", compilingGifWait: "جاري تجميع GIF... قد يستغرق هذا بعض الوقت", takeMoment: "قد يستغرق هذا لحظة...", failed: "فشل التصدير", tryAgain: "يرجى المحاولة مرة أخرى", finalizingVideoTitle: "إنهاء الفيديو", compilingGif: "تجميع GIF", exportingFormat: "تصدير {{format}}", compiling: "تجميع", renderingFrames: "تصيير الإطارات", processing: "جاري المعالجة...", finalizing: "جاري الإنهاء...", compilingStatus: "جاري التجميع...", status: "الحالة", format: "الصيغة", frames: "الإطارات", cancelExport: "إلغاء التصدير", savedSuccessfully: "تم حفظ {{format}} بنجاح!" },
  tutorial: ao,
  unsavedChanges: so,
  fileDialogs: io
}, lo = { cancel: "Cancel", save: "Save", delete: "Delete", close: "Close", share: "Share", done: "Done", open: "Open", upload: "Upload", export: "Export", showInFolder: "Show in Folder", file: "File", edit: "Edit", view: "View", window: "Window", quit: "Quit", stopRecording: "Stop Recording", undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select All", minimize: "Minimize", reload: "Reload", forceReload: "Force Reload", toggleDevTools: "Toggle Developer Tools", actualSize: "Actual Size", zoomIn: "Zoom In", zoomOut: "Zoom Out", toggleFullScreen: "Toggle Full Screen", recordingStatus: "Recording: {{source}}", about: "About OpenScreen", services: "Services", hide: "Hide OpenScreen", hideOthers: "Hide Others", unhide: "Show All" }, uo = { play: "Play", pause: "Pause", fullscreen: "Fullscreen", exitFullscreen: "Exit Fullscreen" }, po = { name: "English", short: "EN" }, mo = {
  actions: lo,
  playback: uo,
  locale: po
}, fo = { triggerLabel: "How trimming works", title: "How Trimming Works", description: "Understanding how to cut out unwanted parts of your video.", explanationBefore: "The Trim tool works by defining the segments you want to", remove: "remove", explanationMiddle: " — anything", covered: "covered", explanationAfter: "by a red trim segment will be cut out when you export.", visualExample: "Visual Example", removed: "REMOVED", kept: "Kept", part1: "Part 1", part2: "Part 2", part3: "Part 3", finalVideo: "Final Video", step1Title: "1. Add Trim", step1DescriptionBefore: "Press ", step1DescriptionAfter: " or click the scissors icon to mark a section for removal.", step2Title: "2. Adjust", step2Description: "Drag the edges of the red region to cover exactly what you want to cut out." }, ho = { title: "Unsaved Changes", message: "You have unsaved changes.", detail: "Do you want to save your project before closing?", saveAndClose: "Save & Close", discardAndClose: "Discard & Close", detailNewProject: "Do you want to save your project before creating a new one?", saveAndNewProject: "Save & New Project", discardAndNewProject: "Discard & New Project", detailLoadProject: "Do you want to save your project before loading another one?", saveAndLoadProject: "Save & Load Project", discardAndLoadProject: "Discard & Load Project", newProject: "New Project", importVideo: "Import Video File…", loadProject: "Load Project…", saveProject: "Save Project…", saveProjectAs: "Save Project As…" }, yo = { saveGif: "Save Exported GIF", saveVideo: "Save Exported Video", selectVideo: "Select Video File", saveProject: "Save OpenScreen Project", openProject: "Open OpenScreen Project", gifImage: "GIF Image", mp4Video: "MP4 Video", videoFiles: "Video Files", openscreenProject: "OpenScreen Project", allFiles: "All Files" }, go = {
  export: { complete: "Export Complete", yourFormatReady: "Your {{format}} is ready", showInFolder: "Show in Folder", finalizingVideo: "Finalizing video export...", compilingGifProgress: "Compiling GIF... {{progress}}%", compilingGifWait: "Compiling GIF... This may take a while", takeMoment: "This may take a moment...", failed: "Export Failed", tryAgain: "Please try again", finalizingVideoTitle: "Finalizing Video", compilingGif: "Compiling GIF", exportingFormat: "Exporting {{format}}", compiling: "Compiling", renderingFrames: "Rendering Frames", processing: "Processing...", finalizing: "Finalizing...", compilingStatus: "Compiling...", status: "Status", format: "Format", frames: "Frames", cancelExport: "Cancel Export", savedSuccessfully: "{{format}} saved successfully!" },
  tutorial: fo,
  unsavedChanges: ho,
  fileDialogs: yo
}, wo = { cancel: "Cancelar", save: "Guardar", delete: "Eliminar", close: "Cerrar", share: "Compartir", done: "Listo", open: "Abrir", upload: "Subir", export: "Exportar", showInFolder: "Mostrar en carpeta", file: "Archivo", edit: "Editar", view: "Vista", window: "Ventana", quit: "Salir", stopRecording: "Detener grabación", undo: "Deshacer", redo: "Rehacer", cut: "Cortar", copy: "Copiar", paste: "Pegar", selectAll: "Seleccionar todo", minimize: "Minimizar", reload: "Recargar", forceReload: "Forzar recarga", toggleDevTools: "Alternar herramientas de desarrollador", actualSize: "Tamaño real", zoomIn: "Acercar", zoomOut: "Alejar", toggleFullScreen: "Alternar pantalla completa", recordingStatus: "Grabando: {{source}}", about: "Acerca de OpenScreen", services: "Servicios", hide: "Ocultar OpenScreen", hideOthers: "Ocultar otros", unhide: "Mostrar todo" }, vo = { play: "Reproducir", pause: "Pausar", fullscreen: "Pantalla completa", exitFullscreen: "Salir de pantalla completa" }, So = { name: "Español", short: "ES" }, bo = {
  actions: wo,
  playback: vo,
  locale: So
}, Po = { triggerLabel: "Cómo funciona el recorte", title: "Cómo funciona el recorte", description: "Aprende a eliminar las partes no deseadas de tu video.", explanationBefore: "La herramienta de recorte funciona definiendo los segmentos que deseas", remove: "eliminar", explanationMiddle: " — cualquier parte", covered: "cubierta", explanationAfter: "por un segmento rojo será eliminada al exportar.", visualExample: "Ejemplo visual", removed: "ELIMINADO", kept: "Conservado", part1: "Parte 1", part2: "Parte 2", part3: "Parte 3", finalVideo: "Video final", step1Title: "1. Agregar recorte", step1DescriptionBefore: "Presiona ", step1DescriptionAfter: " o haz clic en el ícono de tijeras para marcar una sección a eliminar.", step2Title: "2. Ajustar", step2Description: "Arrastra los bordes de la región roja para cubrir exactamente lo que deseas eliminar." }, To = { title: "Cambios sin guardar", message: "Tienes cambios sin guardar.", detail: "¿Deseas guardar tu proyecto antes de cerrar?", saveAndClose: "Guardar y cerrar", discardAndClose: "Descartar y cerrar", detailNewProject: "¿Deseas guardar tu proyecto antes de crear uno nuevo?", saveAndNewProject: "Guardar y nuevo proyecto", discardAndNewProject: "Descartar y nuevo proyecto", detailLoadProject: "¿Deseas guardar tu proyecto antes de cargar otro?", saveAndLoadProject: "Guardar y cargar proyecto", discardAndLoadProject: "Descartar y cargar proyecto", loadProject: "Cargar proyecto…", saveProject: "Guardar proyecto…", saveProjectAs: "Guardar proyecto como…", newProject: "Nuevo proyecto", importVideo: "Importar archivo de vídeo…" }, xo = { saveGif: "Guardar GIF exportado", saveVideo: "Guardar video exportado", selectVideo: "Seleccionar archivo de video", saveProject: "Guardar proyecto OpenScreen", openProject: "Abrir proyecto OpenScreen", gifImage: "Imagen GIF", mp4Video: "Video MP4", videoFiles: "Archivos de video", openscreenProject: "Proyecto OpenScreen", allFiles: "Todos los archivos" }, Co = {
  export: { complete: "Exportación completada", yourFormatReady: "Tu {{format}} está listo", showInFolder: "Mostrar en carpeta", finalizingVideo: "Finalizando exportación de video...", compilingGifProgress: "Compilando GIF... {{progress}}%", compilingGifWait: "Compilando GIF... Esto puede tardar un rato", takeMoment: "Esto puede tardar un momento...", failed: "La exportación falló", tryAgain: "Por favor intenta de nuevo", finalizingVideoTitle: "Finalizando video", compilingGif: "Compilando GIF", exportingFormat: "Exportando {{format}}", compiling: "Compilando", renderingFrames: "Renderizando cuadros", processing: "Procesando...", finalizing: "Finalizando...", compilingStatus: "Compilando...", status: "Estado", format: "Formato", frames: "Cuadros", cancelExport: "Cancelar exportación", savedSuccessfully: "¡{{format}} guardado exitosamente!" },
  tutorial: Po,
  unsavedChanges: To,
  fileDialogs: xo
}, Fo = { cancel: "Annuler", save: "Enregistrer", delete: "Supprimer", close: "Fermer", share: "Partager", done: "Terminer", open: "Ouvrir", upload: "Téléverser", export: "Exporter", showInFolder: "Afficher dans le dossier", file: "Fichier", edit: "Éditer", view: "Affichage", window: "Fenêtre", quit: "Quitter", stopRecording: "Arrêter l'enregistrement", undo: "Annuler", redo: "Rétablir", cut: "Couper", copy: "Copier", paste: "Coller", selectAll: "Tout sélectionner", minimize: "Réduire", reload: "Recharger", forceReload: "Forcer le rechargement", toggleDevTools: "Afficher/masquer les outils de développement", actualSize: "Taille réelle", zoomIn: "Zoom avant", zoomOut: "Zoom arrière", toggleFullScreen: "Basculer en plein écran", recordingStatus: "Enregistrement : {{source}}", about: "À propos d’OpenScreen", services: "Services", hide: "Masquer OpenScreen", hideOthers: "Masquer les autres", unhide: "Tout afficher" }, Do = { play: "Lecture", pause: "Pause", fullscreen: "Plein écran", exitFullscreen: "Quitter le plein écran" }, Ao = { name: "Français", short: "FR" }, Oo = {
  actions: Fo,
  playback: Do,
  locale: Ao
}, jo = { triggerLabel: "Comment fonctionne la coupe", title: "Comment fonctionne la coupe", description: "Comprendre comment supprimer les parties indésirables de votre vidéo.", explanationBefore: "L'outil Coupe fonctionne en définissant les segments que vous souhaitez", remove: "supprimer", explanationMiddle: " — tout ce qui est", covered: "couvert", explanationAfter: "par un segment de coupe rouge sera coupé lors de l'export.", visualExample: "Exemple visuel", removed: "SUPPRIMÉ", kept: "Conservé", part1: "Partie 1", part2: "Partie 2", part3: "Partie 3", finalVideo: "Vidéo finale", step1Title: "1. Ajouter une coupe", step1DescriptionBefore: "Appuyez sur ", step1DescriptionAfter: " ou cliquez sur l'icône ciseaux pour marquer une section à supprimer.", step2Title: "2. Ajuster", step2Description: "Faites glisser les bords de la région rouge pour couvrir exactement ce que vous souhaitez couper." }, Io = { title: "Modifications non enregistrées", message: "Vous avez des modifications non enregistrées.", detail: "Voulez-vous enregistrer votre projet avant de fermer ?", saveAndClose: "Enregistrer et fermer", discardAndClose: "Ignorer et fermer", detailNewProject: "Voulez-vous enregistrer votre projet avant d'en créer un nouveau ?", saveAndNewProject: "Enregistrer et nouveau projet", discardAndNewProject: "Ignorer et nouveau projet", detailLoadProject: "Voulez-vous enregistrer votre projet avant d'en charger un autre ?", saveAndLoadProject: "Enregistrer et charger un projet", discardAndLoadProject: "Ignorer et charger un projet", loadProject: "Charger un projet…", saveProject: "Enregistrer le projet…", saveProjectAs: "Enregistrer le projet sous…", newProject: "Nouveau projet", importVideo: "Importer un fichier vidéo…" }, _o = { saveGif: "Enregistrer le GIF exporté", saveVideo: "Enregistrer la vidéo exportée", selectVideo: "Sélectionner un fichier vidéo", saveProject: "Enregistrer le projet OpenScreen", openProject: "Ouvrir un projet OpenScreen", gifImage: "Image GIF", mp4Video: "Vidéo MP4", videoFiles: "Fichiers vidéo", openscreenProject: "Projet OpenScreen", allFiles: "Tous les fichiers" }, Eo = {
  export: { complete: "Export terminé", yourFormatReady: "Votre {{format}} est prêt", showInFolder: "Afficher dans le dossier", finalizingVideo: "Finalisation de l'export vidéo...", compilingGifProgress: "Compilation du GIF... {{progress}}%", compilingGifWait: "Compilation du GIF... Cela peut prendre un moment", takeMoment: "Cela peut prendre un moment...", failed: "Export échoué", tryAgain: "Veuillez réessayer", finalizingVideoTitle: "Finalisation de la vidéo", compilingGif: "Compilation du GIF", exportingFormat: "Export de {{format}}", compiling: "Compilation en cours", renderingFrames: "Rendu des images", processing: "Traitement en cours...", finalizing: "Finalisation...", compilingStatus: "Compilation...", status: "Statut", format: "Format", frames: "Images", cancelExport: "Annuler l'export", savedSuccessfully: "{{format}} enregistré avec succès !" },
  tutorial: jo,
  unsavedChanges: Io,
  fileDialogs: _o
}, Mo = { cancel: "Annulla", save: "Salva", delete: "Elimina", close: "Chiudi", share: "Condividi", done: "Fatto", open: "Apri", upload: "Carica", export: "Esporta", showInFolder: "Mostra nella cartella", file: "File", edit: "Modifica", view: "Visualizza", window: "Finestra", quit: "Esci", stopRecording: "Interrompi registrazione", undo: "Annulla", redo: "Ripeti", cut: "Taglia", copy: "Copia", paste: "Incolla", selectAll: "Seleziona tutto", minimize: "Riduci a icona", reload: "Ricarica", forceReload: "Forza ricarica", toggleDevTools: "Attiva/disattiva strumenti sviluppatore", actualSize: "Dimensione effettiva", zoomIn: "Ingrandisci", zoomOut: "Riduci", toggleFullScreen: "Attiva/disattiva schermo intero", recordingStatus: "Registrazione: {{source}}", about: "Info su OpenScreen", services: "Servizi", hide: "Nascondi OpenScreen", hideOthers: "Nascondi gli altri", unhide: "Mostra tutto" }, ko = { play: "Riproduci", pause: "Pausa", fullscreen: "Schermo intero", exitFullscreen: "Esci dallo schermo intero" }, Ro = { name: "Italiano", short: "IT" }, No = {
  actions: Mo,
  playback: ko,
  locale: Ro
}, Vo = { triggerLabel: "Come funziona il taglio", title: "Come funziona il taglio", description: "Capire come eliminare le parti indesiderate del tuo video.", explanationBefore: "Lo strumento Taglia funziona definendo i segmenti che vuoi", remove: "rimuovere", explanationMiddle: " — tutto ciò", covered: "coperto", explanationAfter: "da un segmento rosso verrà eliminato durante l'esportazione.", visualExample: "Esempio visivo", removed: "RIMOSSO", kept: "Mantenuto", part1: "Parte 1", part2: "Parte 2", part3: "Parte 3", finalVideo: "Video finale", step1Title: "1. Aggiungi taglio", step1DescriptionBefore: "Premi ", step1DescriptionAfter: " o clicca sull'icona delle forbici per contrassegnare una sezione da rimuovere.", step2Title: "2. Regolazione", step2Description: "Trascina i bordi della regione rossa per coprire esattamente ciò che vuoi eliminare." }, Bo = { title: "Modifiche non salvate", message: "Hai delle modifiche non salvate.", detail: "Vuoi salvare il progetto prima di chiudere?", saveAndClose: "Salva e chiudi", discardAndClose: "Scarta e chiudi", loadProject: "Carica progetto…", saveProject: "Salva progetto…", saveProjectAs: "Salva progetto come…", newProject: "Nuovo progetto", importVideo: "Importa file video…", detailNewProject: "Vuoi salvare il progetto prima di crearne uno nuovo?", saveAndNewProject: "Salva e crea nuovo progetto", discardAndNewProject: "Scarta e crea nuovo progetto", detailLoadProject: "Vuoi salvare il progetto prima di caricarne un altro?", saveAndLoadProject: "Salva e carica progetto", discardAndLoadProject: "Scarta e carica progetto" }, zo = { saveGif: "Salva GIF esportata", saveVideo: "Salva video esportato", selectVideo: "Seleziona file video", saveProject: "Salva progetto OpenScreen", openProject: "Apri progetto OpenScreen", gifImage: "Immagine GIF", mp4Video: "Video MP4", videoFiles: "File video", openscreenProject: "Progetto OpenScreen", allFiles: "Tutti i file" }, Uo = {
  export: { complete: "Esportazione completata", yourFormatReady: "Il tuo {{format}} è pronto", showInFolder: "Mostra nella cartella", finalizingVideo: "Finalizzazione esportazione video...", compilingGifProgress: "Compilazione GIF... {{progress}}%", compilingGifWait: "Compilazione GIF... Potrebbe richiedere del tempo", takeMoment: "Ci potrebbe impiegare un momento...", failed: "Esportazione fallita", tryAgain: "Riprova", finalizingVideoTitle: "Finalizzazione video", compilingGif: "Compilazione GIF", exportingFormat: "Esportazione {{format}}", compiling: "Compilazione", renderingFrames: "Rendering fotogrammi", processing: "Elaborazione...", finalizing: "Finalizzazione...", compilingStatus: "Compilazione...", status: "Stato", format: "Formato", frames: "Fotogrammi", cancelExport: "Annulla esportazione", savedSuccessfully: "{{format}} salvato con successo!" },
  tutorial: Vo,
  unsavedChanges: Bo,
  fileDialogs: zo
}, Wo = { cancel: "キャンセル", save: "保存", delete: "削除", close: "閉じる", share: "共有", done: "完了", open: "開く", upload: "読み込む", export: "エクスポート", showInFolder: "フォルダに表示", file: "ファイル", edit: "編集", view: "表示", window: "ウィンドウ", quit: "終了", stopRecording: "録画を停止", undo: "元に戻す", redo: "やり直す", cut: "切り取り", copy: "コピー", paste: "貼り付け", selectAll: "すべて選択", minimize: "最小化", reload: "再読み込み", forceReload: "強制再読み込み", toggleDevTools: "開発者ツールを切り替え", actualSize: "実際のサイズ", zoomIn: "拡大", zoomOut: "縮小", toggleFullScreen: "フルスクリーンを切り替え", recordingStatus: "録画中: {{source}}", about: "OpenScreenについて", services: "サービス", hide: "OpenScreenを隠す", hideOthers: "ほかを隠す", unhide: "すべて表示" }, Lo = { play: "再生", pause: "一時停止", fullscreen: "全画面表示", exitFullscreen: "全画面表示を終了" }, $o = { name: "日本語", short: "JA" }, Go = {
  actions: Wo,
  playback: Lo,
  locale: $o
}, Ho = { triggerLabel: "トリミングの仕組み", title: "トリミングの仕組み", description: "動画の不要な部分を削除する方法について解説します。", explanationBefore: "トリムツールは、動画から", remove: "「削除したい部分」", explanationMiddle: "を指定することで機能します。エクスポート時には、赤い枠で", covered: "囲まれた部分", explanationAfter: "がすべてカットされます。", visualExample: "視覚的な例", removed: "削除", kept: "保持", part1: "パート 1", part2: "パート 2", part3: "パート 3", finalVideo: "完成動画", step1Title: "1. 削除範囲を追加", step1DescriptionBefore: "キーボードの", step1DescriptionAfter: "、またはハサミのアイコンをクリックして、削除したい範囲を指定します。", step2Title: "2. 範囲を調整", step2Description: "赤い領域の両端をドラッグして、削除したい範囲を正確に調整します。" }, Ko = { title: "未保存の変更", message: "未保存の変更があります。", detail: "閉じる前にプロジェクトを保存しますか？", saveAndClose: "保存して閉じる", discardAndClose: "破棄して閉じる", detailNewProject: "新しいプロジェクトを作成する前に保存しますか？", saveAndNewProject: "保存して新規プロジェクト", discardAndNewProject: "破棄して新規プロジェクト", detailLoadProject: "別のプロジェクトを読み込む前にプロジェクトを保存しますか？", saveAndLoadProject: "保存してプロジェクトを読み込む", discardAndLoadProject: "破棄してプロジェクトを読み込む", loadProject: "プロジェクトを読み込む…", saveProject: "プロジェクトを保存…", saveProjectAs: "プロジェクトを名前を付けて保存…", newProject: "新規プロジェクト", importVideo: "動画ファイルを読み込む…" }, Yo = { saveGif: "エクスポートしたGIFを保存", saveVideo: "エクスポートした動画を保存", selectVideo: "動画ファイルを選択", saveProject: "OpenScreen プロジェクトを保存", openProject: "OpenScreen プロジェクトを開く", gifImage: "GIF 画像", mp4Video: "MP4 動画", videoFiles: "動画ファイル", openscreenProject: "OpenScreen プロジェクト", allFiles: "すべてのファイル" }, Jo = {
  export: { complete: "エクスポート完了", yourFormatReady: "{{format}}の準備ができました", showInFolder: "フォルダで表示", finalizingVideo: "動画のエクスポートを仕上げています...", compilingGifProgress: "GIFを生成中... {{progress}}%", compilingGifWait: "GIFを生成中... しばらくお待ちください", takeMoment: "少々お待ちください...", failed: "エクスポートに失敗しました", tryAgain: "もう一度お試しください", finalizingVideoTitle: "動画の仕上げ", compilingGif: "GIFを生成中", exportingFormat: "{{format}}をエクスポート中", compiling: "生成中", renderingFrames: "フレームをレンダリング中", processing: "処理中...", finalizing: "最終処理中...", compilingStatus: "生成中...", status: "ステータス", format: "フォーマット", frames: "フレーム", cancelExport: "エクスポートをキャンセル", savedSuccessfully: "{{format}}を正常に保存しました！" },
  tutorial: Ho,
  unsavedChanges: Ko,
  fileDialogs: Yo
}, Xo = { cancel: "취소", save: "저장", delete: "삭제", close: "닫기", share: "공유", done: "완료", open: "열기", upload: "업로드", export: "내보내기", showInFolder: "폴더에 표시", file: "파일", edit: "편집", view: "보기", window: "창", quit: "종료", stopRecording: "녹화 중지", undo: "실행 취소", redo: "다시 실행", cut: "잘라내기", copy: "복사", paste: "붙여넣기", selectAll: "모두 선택", minimize: "최소화", reload: "새로고침", forceReload: "강제 새로고침", toggleDevTools: "개발자 도구 전환", actualSize: "실제 크기", zoomIn: "확대", zoomOut: "축소", toggleFullScreen: "전체 화면 전환", recordingStatus: "녹화 중: {{source}}", about: "OpenScreen 정보", services: "서비스", hide: "OpenScreen 숨기기", hideOthers: "다른 항목 숨기기", unhide: "모두 보기" }, qo = { play: "재생", pause: "일시정지", fullscreen: "전체화면", exitFullscreen: "전체화면 종료" }, Zo = { name: "한국어", short: "KO" }, Qo = {
  actions: Xo,
  playback: qo,
  locale: Zo
}, ea = { triggerLabel: "트리밍 사용법", title: "트리밍 사용법", description: "비디오에서 불필요한 부분을 잘라내는 방법을 알아보세요.", explanationBefore: "트림 도구는 제거할 구간을", remove: "지정", explanationMiddle: "하는 방식으로 동작합니다 —", covered: "빨간 트림 구간으로 덮인", explanationAfter: "부분은 내보낼 때 잘려나갑니다.", visualExample: "화면 예시", removed: "제거됨", kept: "유지됨", part1: "파트 1", part2: "파트 2", part3: "파트 3", finalVideo: "최종 비디오", step1Title: "1. 트림 추가", step1DescriptionBefore: "", step1DescriptionAfter: "키를 누르거나 가위 아이콘을 클릭해 제거할 구간을 표시하세요.", step2Title: "2. 조정", step2Description: "빨간 구간의 가장자리를 드래그해 잘라낼 범위를 설정하세요." }, ta = { title: "저장되지 않은 변경 사항", message: "저장되지 않은 변경 사항이 있습니다.", detail: "닫기 전에 프로젝트를 저장하시겠습니까?", saveAndClose: "저장 후 닫기", discardAndClose: "저장하지 않고 닫기", detailNewProject: "새 프로젝트를 만들기 전에 저장하시겠습니까?", saveAndNewProject: "저장 후 새 프로젝트", discardAndNewProject: "저장하지 않고 새 프로젝트", detailLoadProject: "다른 프로젝트를 불러오기 전에 저장하시겠습니까?", saveAndLoadProject: "저장 후 프로젝트 불러오기", discardAndLoadProject: "저장하지 않고 프로젝트 불러오기", loadProject: "프로젝트 불러오기...", saveProject: "프로젝트 저장...", saveProjectAs: "다른 이름으로 프로젝트 저장...", newProject: "새 프로젝트", importVideo: "비디오 파일 가져오기…" }, ra = { saveGif: "내보낸 GIF 저장", saveVideo: "내보낸 비디오 저장", selectVideo: "비디오 파일 선택", saveProject: "OpenScreen 프로젝트 저장", openProject: "OpenScreen 프로젝트 열기", gifImage: "GIF 이미지", mp4Video: "MP4 비디오", videoFiles: "비디오 파일", openscreenProject: "OpenScreen 프로젝트", allFiles: "모든 파일" }, na = {
  export: { complete: "내보내기 완료", yourFormatReady: "{{format}} 파일이 준비되었습니다", showInFolder: "폴더에서 보기", finalizingVideo: "비디오 내보내기 마무리 중...", compilingGifProgress: "GIF 생성 중... {{progress}}%", compilingGifWait: "GIF 생성 중... 잠시 시간이 걸릴 수 있습니다", takeMoment: "잠시 기다려 주세요...", failed: "내보내기 실패", tryAgain: "다시 시도해 주세요", finalizingVideoTitle: "비디오 마무리 중", compilingGif: "GIF 생성 중", exportingFormat: "{{format}} 내보내는 중", compiling: "생성 중...", renderingFrames: "프레임 렌더링 중", processing: "처리 중...", finalizing: "마무리 중...", compilingStatus: "생성 중...", status: "상태", format: "형식", frames: "프레임", cancelExport: "내보내기 취소", savedSuccessfully: "{{format}} 저장이 완료되었습니다!" },
  tutorial: ea,
  unsavedChanges: ta,
  fileDialogs: ra
}, oa = { cancel: "Отмена", save: "Сохранить", delete: "Удалить", close: "Закрыть", share: "Поделиться", done: "Готово", open: "Открыть", upload: "Загрузить", export: "Экспорт", showInFolder: "Показать в папке", file: "Файл", edit: "Редактировать", view: "Вид", window: "Окно", quit: "Выход", stopRecording: "Остановить запись", undo: "Отменить", redo: "Повторить", cut: "Вырезать", copy: "Копировать", paste: "Вставить", selectAll: "Выделить всё", minimize: "Свернуть", reload: "Перезагрузить", forceReload: "Принудительная перезагрузка", toggleDevTools: "Переключить инструменты разработчика", actualSize: "Реальный размер", zoomIn: "Увеличить", zoomOut: "Уменьшить", toggleFullScreen: "Полноэкранный режим", recordingStatus: "Запись: {{source}}", about: "О OpenScreen", services: "Сервисы", hide: "Скрыть OpenScreen", hideOthers: "Скрыть остальные", unhide: "Показать все" }, aa = { play: "Воспроизвести", pause: "Пауза", fullscreen: "Полный экран", exitFullscreen: "Выход из полного экрана" }, sa = { name: "Русский", short: "RU" }, ia = {
  actions: oa,
  playback: aa,
  locale: sa
}, ca = { triggerLabel: "Как работает обрезка", title: "Как работает обрезка", description: "Как вырезать ненужные части видео.", explanationBefore: "Инструмент обрезки работает путём определения сегментов, которые вы хотите", remove: "удалить", explanationMiddle: " — всё, что", covered: "покрыто", explanationAfter: "красным сегментом обрезки, будет вырезано при экспорте.", visualExample: "Визуальный пример", removed: "УДАЛЕНО", kept: "Сохранено", part1: "Часть 1", part2: "Часть 2", part3: "Часть 3", finalVideo: "Итоговое видео", step1Title: "1. Добавить обрезку", step1DescriptionBefore: "Нажмите ", step1DescriptionAfter: " или нажмите на значок ножниц, чтобы отметить секцию для удаления.", step2Title: "2. Настроить", step2Description: "Перетащите края красной области, чтобы точно покрыть то, что вы хотите вырезать." }, la = { title: "Несохранённые изменения", message: "У вас есть несохранённые изменения.", detail: "Хотите сохранить проект перед закрытием?", saveAndClose: "Сохранить и закрыть", discardAndClose: "Отменить и закрыть", detailNewProject: "Хотите сохранить проект перед созданием нового?", saveAndNewProject: "Сохранить и новый проект", discardAndNewProject: "Отменить и новый проект", detailLoadProject: "Хотите сохранить проект перед загрузкой другого?", saveAndLoadProject: "Сохранить и загрузить проект", discardAndLoadProject: "Отменить и загрузить проект", loadProject: "Загрузить проект…", saveProject: "Сохранить проект…", saveProjectAs: "Сохранить проект как…", newProject: "Новый проект", importVideo: "Импортировать видеофайл…" }, ua = { saveGif: "Сохранить экспортированный GIF", saveVideo: "Сохранить экспортированное видео", selectVideo: "Выбрать видеофайл", saveProject: "Сохранить проект OpenScreen", openProject: "Открыть проект OpenScreen", gifImage: "GIF изображение", mp4Video: "MP4 видео", videoFiles: "Видеофайлы", openscreenProject: "Проект OpenScreen", allFiles: "Все файлы" }, da = {
  export: { complete: "Экспорт завершён", yourFormatReady: "Ваш {{format}} готов", showInFolder: "Показать в папке", finalizingVideo: "Завершение экспорта видео...", compilingGifProgress: "Сборка GIF... {{progress}}%", compilingGifWait: "Сборка GIF... Это может занять некоторое время", takeMoment: "Это может занять некоторое время...", failed: "Экспорт не удался", tryAgain: "Пожалуйста, попробуйте снова", finalizingVideoTitle: "Завершение видео", compilingGif: "Сборка GIF", exportingFormat: "Экспорт {{format}}", compiling: "Сборка", renderingFrames: "Рендеринг кадров", processing: "Обработка...", finalizing: "Завершение...", compilingStatus: "Сборка...", status: "Статус", format: "Формат", frames: "Кадры", cancelExport: "Отменить экспорт", savedSuccessfully: "{{format}} успешно сохранён!" },
  tutorial: ca,
  unsavedChanges: la,
  fileDialogs: ua
}, pa = { cancel: "İptal", save: "Kaydet", delete: "Sil", close: "Kapat", share: "Paylaş", done: "Tamam", open: "Aç", upload: "Yükle", export: "Dışa Aktar", showInFolder: "Klasörde Göster", file: "Dosya", edit: "Düzenle", view: "Görünüm", window: "Pencere", quit: "Çıkış", stopRecording: "Kaydı Durdur", undo: "Geri Al", redo: "Yinele", cut: "Kes", copy: "Kopyala", paste: "Yapıştır", selectAll: "Tümünü Seç", minimize: "Simge Durumuna Küçült", reload: "Yeniden Yükle", forceReload: "Zorla Yeniden Yükle", toggleDevTools: "Geliştirici Araçlarını Aç/Kapat", actualSize: "Gerçek Boyut", zoomIn: "Yakınlaştır", zoomOut: "Uzaklaştır", toggleFullScreen: "Tam Ekranı Aç/Kapat", recordingStatus: "Kaydediliyor: {{source}}", about: "OpenScreen Hakkında", services: "Servisler", hide: "OpenScreen’i Gizle", hideOthers: "Diğerlerini Gizle", unhide: "Tümünü Göster" }, ma = { play: "Oynat", pause: "Duraklat", fullscreen: "Tam Ekran", exitFullscreen: "Tam Ekrandan Çık" }, fa = { name: "Türkçe", short: "TR" }, ha = {
  actions: pa,
  playback: ma,
  locale: fa
}, ya = { triggerLabel: "Kırpma nasıl çalışır", title: "Kırpma Nasıl Çalışır", description: "Videonuzun istenmeyen bölümlerini nasıl keseceğinizi anlayın.", explanationBefore: "Kırpma aracı, istediğiniz bölümleri", remove: "kaldırmak", explanationMiddle: " için kullanılır; kırmızı kırpma bölgesiyle", covered: "kaplanan", explanationAfter: "her şey dışa aktarımda kesilecektir.", visualExample: "Görsel Örnek", removed: "KALDIRILDI", kept: "Korundu", part1: "Bölüm 1", part2: "Bölüm 2", part3: "Bölüm 3", finalVideo: "Son Video", step1Title: "1. Kırpma Ekle", step1DescriptionBefore: "Kaldırılacak bölümü işaretlemek için ", step1DescriptionAfter: " tuşuna basın veya makas simgesine tıklayın.", step2Title: "2. Ayarla", step2Description: "Kesmek istediğiniz kısmı tam olarak kaplamak için kırmızı bölgenin kenarlarını sürükleyin." }, ga = { title: "Kaydedilmemiş Değişiklikler", message: "Kaydedilmemiş değişiklikleriniz var.", detail: "Kapatmadan önce projenizi kaydetmek ister misiniz?", saveAndClose: "Kaydet ve Kapat", discardAndClose: "Kaydetmeden Kapat", detailNewProject: "Yeni proje oluşturmadan önce kaydetmek ister misiniz?", saveAndNewProject: "Kaydet ve Yeni Proje", discardAndNewProject: "Kaydetmeden Yeni Proje", detailLoadProject: "Başka bir proje yüklemeden önce kaydetmek ister misiniz?", saveAndLoadProject: "Kaydet ve Proje Yükle", discardAndLoadProject: "Kaydetmeden Proje Yükle", loadProject: "Proje Yükle…", saveProject: "Proje Kaydet…", saveProjectAs: "Farklı Kaydet…", newProject: "Yeni proje", importVideo: "Video dosyası içe aktar…" }, wa = { saveGif: "Dışa Aktarılan GIF'i Kaydet", saveVideo: "Dışa Aktarılan Videoyu Kaydet", selectVideo: "Video Dosyası Seç", saveProject: "OpenScreen Projesini Kaydet", openProject: "OpenScreen Projesini Aç", gifImage: "GIF Görüntüsü", mp4Video: "MP4 Video", videoFiles: "Video Dosyaları", openscreenProject: "OpenScreen Projesi", allFiles: "Tüm Dosyalar" }, va = {
  export: { complete: "Dışa Aktarım Tamamlandı", yourFormatReady: "{{format}} dosyanız hazır", showInFolder: "Klasörde Göster", finalizingVideo: "Video dışa aktarımı sonlandırılıyor...", compilingGifProgress: "GIF derleniyor... %{{progress}}", compilingGifWait: "GIF derleniyor... Bu biraz zaman alabilir", takeMoment: "Bu biraz zaman alabilir...", failed: "Dışa Aktarım Başarısız", tryAgain: "Lütfen tekrar deneyin", finalizingVideoTitle: "Video Sonlandırılıyor", compilingGif: "GIF Derleniyor", exportingFormat: "{{format}} Dışa Aktarılıyor", compiling: "Derleniyor", renderingFrames: "Kareler İşleniyor", processing: "İşleniyor...", finalizing: "Sonlandırılıyor...", compilingStatus: "Derleniyor...", status: "Durum", format: "Biçim", frames: "Kareler", cancelExport: "Dışa Aktarımı İptal Et", savedSuccessfully: "{{format}} başarıyla kaydedildi!" },
  tutorial: ya,
  unsavedChanges: ga,
  fileDialogs: wa
}, Sa = { cancel: "Hủy", save: "Lưu", delete: "Xóa", close: "Đóng", share: "Chia sẻ", done: "Hoàn tất", open: "Mở", upload: "Tải lên", export: "Xuất", showInFolder: "Hiển thị trong thư mục", file: "Tệp", edit: "Chỉnh sửa", view: "Xem", window: "Cửa sổ", quit: "Thoát", stopRecording: "Dừng ghi hình", undo: "Hoàn tác", redo: "Làm lại", cut: "Cắt", copy: "Sao chép", paste: "Dán", selectAll: "Chọn tất cả", minimize: "Thu nhỏ", reload: "Tải lại", forceReload: "Buộc tải lại", toggleDevTools: "Bật/tắt công cụ nhà phát triển", actualSize: "Kích thước thực", zoomIn: "Phóng to", zoomOut: "Thu nhỏ", toggleFullScreen: "Bật/tắt toàn màn hình", recordingStatus: "Đang ghi: {{source}}", about: "Giới thiệu OpenScreen", services: "Dịch vụ", hide: "Ẩn OpenScreen", hideOthers: "Ẩn ứng dụng khác", unhide: "Hiển thị tất cả" }, ba = { play: "Phát", pause: "Tạm dừng", fullscreen: "Toàn màn hình", exitFullscreen: "Thoát toàn màn hình" }, Pa = { name: "Tiếng Việt", short: "VI" }, Ta = {
  actions: Sa,
  playback: ba,
  locale: Pa
}, xa = { triggerLabel: "Cách hoạt động của công cụ cắt", title: "Cách cắt video", description: "Hiểu cách cắt bỏ các phần không mong muốn trong video của bạn.", explanationBefore: "Công cụ Cắt hoạt động bằng cách xác định các đoạn bạn muốn", remove: "xóa", explanationMiddle: " — bất cứ thứ gì", covered: "được bao phủ", explanationAfter: "bởi một đoạn cắt màu đỏ sẽ bị loại bỏ khi bạn xuất.", visualExample: "Ví dụ trực quan", removed: "ĐÃ XÓA", kept: "Giữ lại", part1: "Phần 1", part2: "Phần 2", part3: "Phần 3", finalVideo: "Video cuối cùng", step1Title: "1. Thêm đoạn cắt", step1DescriptionBefore: "Nhấn ", step1DescriptionAfter: " hoặc nhấp vào biểu tượng cái kéo để đánh dấu một phần cần xóa.", step2Title: "2. Điều chỉnh", step2Description: "Kéo các cạnh của vùng màu đỏ để bao phủ chính xác những gì bạn muốn cắt bỏ." }, Ca = { title: "Thay đổi chưa được lưu", message: "Bạn có các thay đổi chưa được lưu.", detail: "Bạn có muốn lưu dự án của mình trước khi đóng không?", saveAndClose: "Lưu & Đóng", discardAndClose: "Bỏ qua & Đóng", detailNewProject: "Bạn có muốn lưu dự án trước khi tạo dự án mới không?", saveAndNewProject: "Lưu & Dự án mới", discardAndNewProject: "Bỏ qua & Dự án mới", detailLoadProject: "Bạn có muốn lưu dự án của mình trước khi tải dự án khác không?", saveAndLoadProject: "Lưu & Tải dự án", discardAndLoadProject: "Bỏ qua & Tải dự án", loadProject: "Tải dự án…", saveProject: "Lưu dự án…", saveProjectAs: "Lưu dự án thành…", newProject: "Dự án mới", importVideo: "Nhập tệp video…" }, Fa = { saveGif: "Lưu GIF đã xuất", saveVideo: "Lưu Video đã xuất", selectVideo: "Chọn tệp video", saveProject: "Lưu dự án OpenScreen", openProject: "Mở dự án OpenScreen", gifImage: "Hình ảnh GIF", mp4Video: "Video MP4", videoFiles: "Tệp Video", openscreenProject: "Dự án OpenScreen", allFiles: "Tất cả các tệp" }, Da = {
  export: { complete: "Xuất hoàn tất", yourFormatReady: "{{format}} của bạn đã sẵn sàng", showInFolder: "Hiển thị trong thư mục", finalizingVideo: "Đang hoàn tất xuất video...", compilingGifProgress: "Đang biên dịch GIF... {{progress}}%", compilingGifWait: "Đang biên dịch GIF... Có thể mất một lúc", takeMoment: "Có thể mất một chút thời gian...", failed: "Xuất thất bại", tryAgain: "Vui lòng thử lại", finalizingVideoTitle: "Hoàn tất video", compilingGif: "Biên dịch GIF", exportingFormat: "Đang xuất {{format}}", compiling: "Đang biên dịch", renderingFrames: "Kết xuất khung hình", processing: "Đang xử lý...", finalizing: "Đang hoàn tất...", compilingStatus: "Đang biên dịch...", status: "Trạng thái", format: "Định dạng", frames: "Khung hình", cancelExport: "Hủy xuất", savedSuccessfully: "Đã lưu {{format}} thành công!" },
  tutorial: xa,
  unsavedChanges: Ca,
  fileDialogs: Fa
}, Aa = { cancel: "取消", save: "保存", delete: "删除", close: "关闭", share: "分享", done: "完成", open: "打开", upload: "上传", export: "导出", showInFolder: "在文件夹中显示", file: "文件", edit: "编辑", view: "视图", window: "窗口", quit: "退出", stopRecording: "停止录制", undo: "撤销", redo: "重做", cut: "剪切", copy: "复制", paste: "粘贴", selectAll: "全选", minimize: "最小化", reload: "重新加载", forceReload: "强制重新加载", toggleDevTools: "切换开发者工具", actualSize: "实际大小", zoomIn: "放大", zoomOut: "缩小", toggleFullScreen: "切换全屏", recordingStatus: "正在录制：{{source}}", about: "关于 OpenScreen", services: "服务", hide: "隐藏 OpenScreen", hideOthers: "隐藏其他", unhide: "显示全部" }, Oa = { play: "播放", pause: "暂停", fullscreen: "全屏", exitFullscreen: "退出全屏" }, ja = { name: "简体中文", short: "简中" }, Ia = {
  actions: Aa,
  playback: Oa,
  locale: ja
}, _a = { triggerLabel: "剪辑功能说明", title: "剪辑功能说明", description: "了解如何剪掉视频中不需要的部分。", explanationBefore: "剪辑工具通过定义您要", remove: "移除", explanationMiddle: "——任何被", covered: "覆盖", explanationAfter: "的红色剪辑区域部分将在导出时被剪掉。", visualExample: "示例演示", removed: "已移除", kept: "保留", part1: "第 1 部分", part2: "第 2 部分", part3: "第 3 部分", finalVideo: "最终视频", step1Title: "1. 添加剪辑", step1DescriptionBefore: "按", step1DescriptionAfter: "键或点击剪刀图标来标记要移除的片段。", step2Title: "2. 调整", step2Description: "拖动红色区域的边缘，精确覆盖您要剪掉的部分。" }, Ea = { title: "未保存的更改", message: "您有未保存的更改。", detail: "是否在关闭前保存项目？", saveAndClose: "保存并关闭", discardAndClose: "放弃并关闭", detailNewProject: "是否在创建新项目前保存当前项目？", saveAndNewProject: "保存并新建项目", discardAndNewProject: "放弃并新建项目", detailLoadProject: "是否在加载其他项目前保存当前项目？", saveAndLoadProject: "保存并加载项目", discardAndLoadProject: "放弃并加载项目", loadProject: "加载项目…", saveProject: "保存项目…", saveProjectAs: "项目另存为…", newProject: "新建项目", importVideo: "导入视频文件…" }, Ma = { saveGif: "保存导出的 GIF", saveVideo: "保存导出的视频", selectVideo: "选择视频文件", saveProject: "保存 OpenScreen 项目", openProject: "打开 OpenScreen 项目", gifImage: "GIF 图片", mp4Video: "MP4 视频", videoFiles: "视频文件", openscreenProject: "OpenScreen 项目", allFiles: "所有文件" }, ka = {
  export: { complete: "导出完成", yourFormatReady: "您的 {{format}} 已准备就绪", showInFolder: "在文件夹中显示", finalizingVideo: "正在完成视频导出...", compilingGifProgress: "正在编译 GIF... {{progress}}%", compilingGifWait: "正在编译 GIF... 这可能需要一些时间", takeMoment: "这可能需要一点时间...", failed: "导出失败", tryAgain: "请重试", finalizingVideoTitle: "正在完成视频", compilingGif: "正在编译 GIF", exportingFormat: "正在导出 {{format}}", compiling: "编译中", renderingFrames: "渲染帧", processing: "处理中...", finalizing: "正在完成...", compilingStatus: "编译中...", status: "状态", format: "格式", frames: "帧", cancelExport: "取消导出", savedSuccessfully: "{{format}} 保存成功！" },
  tutorial: _a,
  unsavedChanges: Ea,
  fileDialogs: Ma
}, Ra = { cancel: "取消", save: "儲存", delete: "刪除", close: "關閉", share: "分享", done: "完成", open: "開啟", upload: "上傳", export: "匯出", showInFolder: "在資料夾中顯示", file: "檔案", edit: "編輯", view: "檢視", window: "視窗", quit: "退出", stopRecording: "停止錄製", undo: "復原", redo: "重做", cut: "剪下", copy: "複製", paste: "貼上", selectAll: "全選", minimize: "最小化", reload: "重新載入", forceReload: "強制重新載入", toggleDevTools: "切換開發者工具", actualSize: "實際大小", zoomIn: "放大", zoomOut: "縮小", toggleFullScreen: "切換全螢幕", recordingStatus: "錄製中：{{source}}", about: "關於 OpenScreen", services: "服務", hide: "隱藏 OpenScreen", hideOthers: "隱藏其他", unhide: "全部顯示" }, Na = { play: "播放", pause: "暫停", fullscreen: "全螢幕", exitFullscreen: "退出全螢幕" }, Va = { name: "繁體中文", short: "繁中" }, Ba = {
  actions: Ra,
  playback: Na,
  locale: Va
}, za = { triggerLabel: "剪輯功能說明", title: "剪輯功能說明", description: "了解如何剪掉影片中不需要的部分。", explanationBefore: "剪輯工具透過定義您要", remove: "移除", explanationMiddle: "——任何被", covered: "覆蓋", explanationAfter: "的紅色剪輯區域部分將在匯出時被剪掉。", visualExample: "示例演示", removed: "已移除", kept: "保留", part1: "第 1 部分", part2: "第 2 部分", part3: "第 3 部分", finalVideo: "最終影片", step1Title: "1. 添加剪輯", step1DescriptionBefore: "按", step1DescriptionAfter: "鍵或點擊剪刀圖示來標記要移除的片段。", step2Title: "2. 調整", step2Description: "拖動紅色區域的邊緣，精確覆蓋您要剪掉的部分。" }, Ua = { title: "未儲存的變更", message: "您有未儲存的變更。", detail: "是否在關閉前儲存專案？", saveAndClose: "儲存並關閉", discardAndClose: "捨棄並關閉", detailNewProject: "是否在建立新專案前儲存目前的專案？", saveAndNewProject: "儲存並建立新專案", discardAndNewProject: "捨棄並建立新專案", detailLoadProject: "是否在載入其他專案前儲存目前的專案？", saveAndLoadProject: "儲存並載入專案", discardAndLoadProject: "捨棄並載入專案", loadProject: "載入專案…", saveProject: "儲存專案…", saveProjectAs: "專案另存新檔…", newProject: "新增專案", importVideo: "匯入影片檔…" }, Wa = { saveGif: "儲存匯出的 GIF", saveVideo: "儲存匯出的影片", selectVideo: "選擇影片檔案", saveProject: "儲存 OpenScreen 專案", openProject: "開啟 OpenScreen 專案", gifImage: "GIF 圖片", mp4Video: "MP4 影片", videoFiles: "影片檔案", openscreenProject: "OpenScreen 專案", allFiles: "所有檔案" }, La = {
  export: { complete: "匯出完成", yourFormatReady: "您的 {{format}} 已準備就緒", showInFolder: "在資料夾中顯示", finalizingVideo: "正在完成影片匯出...", compilingGifProgress: "正在編譯 GIF... {{progress}}%", compilingGifWait: "正在編譯 GIF... 這可能需要一些時間", takeMoment: "這可能需要一點時間...", failed: "匯出失敗", tryAgain: "請重試", finalizingVideoTitle: "正在完成影片", compilingGif: "正在編譯 GIF", exportingFormat: "正在匯出 {{format}}", compiling: "編譯中", renderingFrames: "渲染影格", processing: "處理中...", finalizing: "正在完成...", compilingStatus: "編譯中...", status: "狀態", format: "格式", frames: "影格", cancelExport: "取消匯出", savedSuccessfully: "{{format}} 儲存成功！" },
  tutorial: za,
  unsavedChanges: Ua,
  fileDialogs: Wa
}, Fr = {
  en: { common: mo, dialogs: go },
  ar: { common: oo, dialogs: co },
  es: { common: bo, dialogs: Co },
  fr: { common: Oo, dialogs: Eo },
  it: { common: No, dialogs: Uo },
  "ja-JP": { common: Go, dialogs: Jo },
  "ko-KR": { common: Qo, dialogs: na },
  ru: { common: ia, dialogs: da },
  tr: { common: ha, dialogs: va },
  vi: { common: Ta, dialogs: Da },
  "zh-CN": { common: Ia, dialogs: ka },
  "zh-TW": { common: Ba, dialogs: La }
};
let yn = "en";
function $a(e) {
  (e === "en" || e === "ar" || e === "es" || e === "fr" || e === "it" || e === "ja-JP" || e === "ko-KR" || e === "ru" || e === "tr" || e === "vi" || e === "zh-CN" || e === "zh-TW") && (yn = e);
}
function Dr(e, t) {
  const r = t.split(".");
  let n = e;
  for (const a of r) {
    if (n == null || typeof n != "object") return;
    n = n[a];
  }
  return typeof n == "string" ? n : void 0;
}
function Ga(e, t) {
  return t ? e.replace(/\{\{(\w+)\}\}/g, (r, n) => String(t[n] ?? `{{${n}}}`)) : e;
}
function I(e, t, r) {
  const n = Dr(Fr[yn]?.[e], t) ?? Dr(Fr.en?.[e], t);
  return n == null ? `${e}.${t}` : Ga(n, r);
}
const Ht = "openscreen-macos-cursor-helper", gn = 5e3;
function Ha() {
  const e = process.env.OPENSCREEN_MAC_CURSOR_HELPER_EXE?.trim(), t = process.env.APP_ROOT ? b.resolve(process.env.APP_ROOT) : process.cwd(), r = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64", n = typeof process.resourcesPath == "string" ? process.resourcesPath : b.join(t, "resources");
  return [
    e,
    b.join(t, "electron", "native", "screencapturekit", "build", Ht),
    b.join(t, "electron", "native", "bin", r, Ht),
    b.join(n, "electron", "native", "bin", r, Ht)
  ].filter((a) => !!a);
}
function wn() {
  for (const e of Ha())
    try {
      return Kn(e, wt.X_OK), e;
    } catch {
    }
  return null;
}
async function Ka() {
  if (process.platform !== "darwin")
    return { success: !0, granted: !0, status: "granted" };
  let e = !1;
  try {
    e = ue.isTrustedAccessibilityClient(!1);
  } catch {
  }
  if (!e) return { success: !0, granted: !1, status: "not-determined" };
  const t = wn();
  return t ? new Promise(
    (r) => {
      const n = Ve(t, [JSON.stringify({ sampleIntervalMs: 250 })], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let a = !1, i = "";
      const p = (m) => {
        a || (a = !0, clearTimeout(h), n.killed || n.kill("SIGTERM"), r(m));
      }, h = setTimeout(() => {
        p({
          success: !1,
          granted: !1,
          status: "timeout",
          error: "Timed out waiting for macOS cursor helper"
        });
      }, gn);
      n.stdout.setEncoding("utf8"), n.stdout.on("data", (m) => {
        i += m;
        const w = i.split(/\r?\n/);
        i = w.pop() ?? "";
        for (const C of w) {
          const k = C.trim();
          if (k)
            try {
              const B = JSON.parse(k);
              if (B.type === "ready") {
                p({
                  success: !0,
                  granted: B.accessibilityTrusted === !0,
                  status: B.accessibilityTrusted === !0 ? "granted" : "not-determined"
                });
                return;
              }
            } catch {
            }
        }
      }), n.once("error", (m) => {
        p({
          success: !1,
          granted: !1,
          status: "error",
          error: m.message
        });
      }), n.once("exit", (m, w) => {
        p({
          success: !1,
          granted: !1,
          status: "exited",
          error: `macOS cursor helper exited before ready (code=${m}, signal=${w})`
        });
      });
    }
  ) : { success: !0, granted: !1, status: "missing-helper" };
}
function Ar(e, t, r) {
  return Math.min(r, Math.max(t, e));
}
function Ya(e) {
  return e === "arrow" || e === "pointer" || e === "text" ? e : null;
}
class vr {
  constructor(t) {
    this.options = t;
  }
  options;
  samples = [];
  assets = /* @__PURE__ */ new Map();
  process = null;
  lineBuffer = "";
  startTimeMs = 0;
  fallbackInterval = null;
  readyResolve = null;
  readyReject = null;
  readyTimer = null;
  previousLeftButtonDown = !1;
  consecutiveOutsideSamples = 0;
  // Hide only after this many consecutive out-of-bounds samples (~100ms at 33ms interval).
  // Fast swipes that briefly exit the display are clipped by clip-path instead of disappearing.
  static OUTSIDE_HIDE_THRESHOLD = 3;
  async start() {
    if (this.samples = [], this.assets.clear(), this.lineBuffer = "", this.startTimeMs = this.options.startTimeMs ?? Date.now(), this.previousLeftButtonDown = !1, this.consecutiveOutsideSamples = 0, process.env.OPENSCREEN_ENABLE_MAC_CURSOR_HELPER !== "1") {
      this.startPositionOnlyFallback();
      return;
    }
    const t = wn();
    if (!t) {
      this.startPositionOnlyFallback();
      return;
    }
    const r = Ve(
      t,
      [
        JSON.stringify({
          sampleIntervalMs: this.options.sampleIntervalMs
        })
      ],
      {
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    this.process = r, r.stdout.setEncoding("utf8"), r.stdout.on("data", (n) => this.handleStdoutChunk(n)), r.stderr.setEncoding("utf8"), r.stderr.on("data", (n) => {
      const a = n.trim();
      a && console.error("[cursor-macos]", a);
    }), r.once("exit", (n, a) => {
      this.rejectReady(
        new Error(`macOS cursor helper exited before ready (code=${n}, signal=${a})`)
      ), this.process = null;
    }), r.once("error", (n) => {
      this.rejectReady(n), this.process = null;
    });
    try {
      await this.waitUntilReady();
    } catch (n) {
      this.killHelperProcess(r), this.process = null, console.warn("[cursor-macos] falling back to position-only cursor telemetry:", n), this.startPositionOnlyFallback();
    }
  }
  async stop() {
    const t = this.process;
    return this.process = null, this.clearReadyState(), this.fallbackInterval && (clearInterval(this.fallbackInterval), this.fallbackInterval = null), t && this.killHelperProcess(t), {
      version: 2,
      provider: this.assets.size > 0 ? "native" : "none",
      samples: this.samples,
      assets: [...this.assets.values()]
    };
  }
  startPositionOnlyFallback() {
    this.captureSample(Date.now(), null, null, !1, !1, !1), this.fallbackInterval = setInterval(() => {
      this.captureSample(Date.now(), null, null, !1, !1, !1);
    }, this.options.sampleIntervalMs);
  }
  rememberAsset(t) {
    if (!t?.id || this.assets.has(t.id))
      return;
    const r = K.getCursorScreenPoint(), n = K.getDisplayNearestPoint(r).scaleFactor;
    this.assets.set(t.id, {
      id: t.id,
      platform: "darwin",
      imageDataUrl: t.imageDataUrl,
      width: t.width,
      height: t.height,
      hotspotX: t.hotspotX,
      hotspotY: t.hotspotY,
      scaleFactor: t.scaleFactor ?? n
    });
  }
  handleStdoutChunk(t) {
    this.lineBuffer += t;
    const r = this.lineBuffer.split(/\r?\n/);
    this.lineBuffer = r.pop() ?? "";
    for (const n of r) {
      const a = n.trim();
      if (a)
        try {
          this.handleEvent(JSON.parse(a));
        } catch (i) {
          console.error("Failed to parse macOS cursor helper output:", i, a);
        }
    }
  }
  handleEvent(t) {
    if (t.type === "ready") {
      t.accessibilityTrusted === !1 && console.warn(
        "[cursor-macos] Accessibility is not trusted; text/pointer affordance detection disabled (bitmap capture still active)."
      ), this.resolveReady();
      return;
    }
    t.type === "sample" && (this.rememberAsset(t.asset), this.captureSample(
      t.timestampMs,
      Ya(t.cursorType),
      t.assetId ?? null,
      t.leftButtonDown === !0,
      t.leftButtonPressed === !0,
      t.leftButtonReleased === !0
    ));
  }
  captureSample(t, r, n, a, i, p) {
    const h = K.getCursorScreenPoint(), m = this.options.getDisplayBounds() ?? K.getDisplayNearestPoint(h).bounds, w = Math.max(1, m.width), C = Math.max(1, m.height), k = (h.x - m.x) / w, B = (h.y - m.y) / C;
    k < 0 || k > 1 || B < 0 || B > 1 ? this.consecutiveOutsideSamples++ : this.consecutiveOutsideSamples = 0;
    const Q = this.consecutiveOutsideSamples < vr.OUTSIDE_HIDE_THRESHOLD, se = i || a && !this.previousLeftButtonDown ? "click" : p || !a && this.previousLeftButtonDown ? "mouseup" : "move";
    this.previousLeftButtonDown = a, this.samples.push({
      timeMs: Math.max(0, t - this.startTimeMs),
      cx: Ar(k, 0, 1),
      cy: Ar(B, 0, 1),
      visible: Q,
      interactionType: se,
      ...n ? { assetId: n } : {},
      ...r ? { cursorType: r } : {}
    }), this.samples.length > this.options.maxSamples && this.samples.shift();
  }
  waitUntilReady() {
    return new Promise((t, r) => {
      this.readyResolve = t, this.readyReject = r, this.readyTimer = setTimeout(() => {
        this.rejectReady(new Error("Timed out waiting for macOS cursor helper"));
      }, gn);
    });
  }
  resolveReady() {
    const t = this.readyResolve;
    this.clearReadyState(), t?.();
  }
  rejectReady(t) {
    const r = this.readyReject;
    this.clearReadyState(), r?.(t);
  }
  clearReadyState() {
    this.readyTimer && (clearTimeout(this.readyTimer), this.readyTimer = null), this.readyResolve = null, this.readyReject = null;
  }
  killHelperProcess(t) {
    t.killed || (t.kill("SIGTERM"), setTimeout(() => {
      t.killed || t.kill("SIGKILL");
    }, 500).unref());
  }
}
function Or(e, t, r) {
  return Math.min(r, Math.max(t, e));
}
class Ja {
  constructor(t) {
    this.options = t;
  }
  options;
  samples = [];
  interval = null;
  startTimeMs = 0;
  async start() {
    this.samples = [], this.startTimeMs = this.options.startTimeMs ?? Date.now(), this.captureSample(), this.interval = setInterval(() => {
      this.captureSample();
    }, this.options.sampleIntervalMs);
  }
  async stop() {
    return this.interval && (clearInterval(this.interval), this.interval = null), {
      version: 2,
      provider: "none",
      samples: this.samples,
      assets: []
    };
  }
  captureSample() {
    const t = K.getCursorScreenPoint(), r = this.options.getDisplayBounds() ?? K.getDisplayNearestPoint(t).bounds, n = Math.max(1, r.width), a = Math.max(1, r.height);
    this.samples.push({
      timeMs: Math.max(0, Date.now() - this.startTimeMs),
      cx: Or((t.x - r.x) / n, 0, 1),
      cy: Or((t.y - r.y) / a, 0, 1),
      visible: !0
    }), this.samples.length > this.options.maxSamples && this.samples.shift();
  }
}
function Xa(e) {
  if (!e?.startsWith("window:"))
    return null;
  const t = e.split(":")[1];
  return !t || !/^\d+$/.test(t) ? null : t;
}
function qa() {
  const e = process.env.OPENSCREEN_CURSOR_SAMPLER_EXE?.trim(), t = process.arch === "arm64" ? "win32-arm64" : "win32-x64", r = (...a) => {
    const i = Tr(V.getAppPath(), ...a);
    return V.isPackaged ? i.replace(/\.asar([/\\])/, ".asar.unpacked$1") : i;
  }, n = (...a) => V.isPackaged ? Tr(process.resourcesPath, ...a) : null;
  return [
    e,
    r("electron", "native", "wgc-capture", "build", "cursor-sampler.exe"),
    r("electron", "native", "bin", t, "cursor-sampler.exe"),
    n("electron", "native", "bin", t, "cursor-sampler.exe")
  ].filter((a) => !!a);
}
function Za() {
  for (const e of qa())
    if (Yn(e)) return e;
  return null;
}
const Qa = 5e3;
class es {
  constructor(t) {
    this.options = t;
  }
  options;
  assets = /* @__PURE__ */ new Map();
  samples = [];
  process = null;
  lineBuffer = "";
  startTimeMs = 0;
  readyResolve = null;
  readyReject = null;
  readyTimer = null;
  sampleCount = 0;
  outOfBoundsSampleCount = 0;
  previousLeftButtonDown = !1;
  async start() {
    this.assets.clear(), this.samples = [], this.lineBuffer = "", this.startTimeMs = this.options.startTimeMs ?? Date.now(), this.sampleCount = 0, this.outOfBoundsSampleCount = 0, this.previousLeftButtonDown = !1;
    const t = Za();
    if (!t)
      throw new Error("Windows cursor sampler helper is not available.");
    const r = Xa(this.options.sourceId), n = [String(this.options.sampleIntervalMs)];
    r && n.push(r);
    const a = Ve(t, n, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: !0
    });
    this.process = a, this.logDiagnostic("spawn", {
      pid: a.pid ?? null,
      sampleIntervalMs: this.options.sampleIntervalMs,
      sourceId: this.options.sourceId ?? null,
      windowHandle: r
    }), a.stdout.setEncoding("utf8"), a.stdout.on("data", (i) => {
      this.handleStdoutChunk(i);
    }), a.stderr.setEncoding("utf8"), a.stderr.on("data", (i) => {
      const p = i.trim();
      p && this.logDiagnostic("stderr", { message: p }), console.error("[cursor-native]", p);
    }), a.once("exit", (i, p) => {
      this.logDiagnostic("exit", {
        code: i,
        signal: p,
        sampleCount: this.sampleCount,
        assetCount: this.assets.size,
        outOfBoundsSampleCount: this.outOfBoundsSampleCount
      }), this.rejectReady(
        new Error(`Windows cursor helper exited before ready (code=${i}, signal=${p})`)
      );
    }), a.once("error", (i) => {
      this.logDiagnostic("process-error", { message: i.message }), this.rejectReady(i);
    });
    try {
      await this.waitUntilReady();
    } catch (i) {
      throw this.terminateHelperProcess(), i;
    }
  }
  async stop() {
    const t = this.process;
    return this.process = null, this.clearReadyState(), this.killHelperProcess(t), this.logDiagnostic("stop", {
      sampleCount: this.sampleCount,
      assetCount: this.assets.size,
      outOfBoundsSampleCount: this.outOfBoundsSampleCount
    }), {
      version: 2,
      provider: this.assets.size > 0 ? "native" : "none",
      samples: this.samples,
      assets: [...this.assets.values()]
    };
  }
  handleStdoutChunk(t) {
    this.lineBuffer += t;
    const r = this.lineBuffer.split(/\r?\n/);
    this.lineBuffer = r.pop() ?? "";
    for (const n of r) {
      const a = n.trim();
      if (a)
        try {
          const i = JSON.parse(a);
          this.handleEvent(i);
        } catch (i) {
          console.error("Failed to parse Windows cursor helper output:", i, a);
        }
    }
  }
  handleEvent(t) {
    if (t.type === "error") {
      this.logDiagnostic("helper-error", { message: t.message }), console.error("Windows cursor helper error:", t.message), this.failHelper(new Error(t.message));
      return;
    }
    if (t.type === "ready") {
      this.logDiagnostic("ready", { timestampMs: t.timestampMs }), this.resolveReady();
      return;
    }
    if (t.asset?.id && !this.assets.has(t.asset.id)) {
      const n = K.getDisplayNearestPoint({ x: t.x, y: t.y });
      this.assets.set(t.asset.id, {
        id: t.asset.id,
        platform: "win32",
        imageDataUrl: t.asset.imageDataUrl,
        width: t.asset.width,
        height: t.asset.height,
        hotspotX: t.asset.hotspotX,
        hotspotY: t.asset.hotspotY,
        scaleFactor: n.scaleFactor,
        cursorType: t.asset.cursorType ?? t.cursorType ?? null
      }), this.logDiagnostic("asset", {
        id: t.asset.id,
        width: t.asset.width,
        height: t.asset.height,
        hotspotX: t.asset.hotspotX,
        hotspotY: t.asset.hotspotY,
        scaleFactor: n.scaleFactor
      });
    }
    const r = this.normalizeSample(t);
    this.sampleCount += 1, r.withinBounds || (this.outOfBoundsSampleCount += 1), this.samples.push(r.sample), this.samples.length > this.options.maxSamples && this.samples.shift();
  }
  normalizeSample(t) {
    const r = t.bounds ?? this.options.getDisplayBounds() ?? K.getPrimaryDisplay().bounds, n = Math.max(1, r.width), a = Math.max(1, r.height), i = (t.x - r.x) / n, p = (t.y - r.y) / a, h = i >= 0 && i <= 1 && p >= 0 && p <= 1, m = t.leftButtonDown === !0, w = t.leftButtonPressed === !0, C = t.leftButtonReleased === !0, k = w || m && !this.previousLeftButtonDown ? "click" : C || !m && this.previousLeftButtonDown ? "mouseup" : "move";
    return this.previousLeftButtonDown = m, (this.sampleCount === 0 || !h && this.outOfBoundsSampleCount === 0) && this.logDiagnostic("sample", {
      rawX: t.x,
      rawY: t.y,
      normalizedX: i,
      normalizedY: p,
      visible: t.visible,
      withinBounds: h,
      bounds: r,
      handle: t.handle
    }), {
      withinBounds: h,
      sample: {
        timeMs: Math.max(0, t.timestampMs - this.startTimeMs),
        cx: i,
        cy: p,
        assetId: t.handle,
        visible: t.visible && h,
        cursorType: t.cursorType ?? t.asset?.cursorType ?? null,
        interactionType: k
      }
    };
  }
  waitUntilReady() {
    return new Promise((t, r) => {
      this.readyResolve = t, this.readyReject = r, this.readyTimer = setTimeout(() => {
        this.rejectReady(new Error("Timed out waiting for Windows cursor helper readiness"));
      }, Qa);
    });
  }
  resolveReady() {
    const t = this.readyResolve;
    this.clearReadyState(), t?.();
  }
  rejectReady(t) {
    const r = this.readyReject;
    this.clearReadyState(), r?.(t);
  }
  failHelper(t) {
    this.rejectReady(t), this.terminateHelperProcess();
  }
  terminateHelperProcess() {
    const t = this.process;
    this.process = null, this.killHelperProcess(t);
  }
  killHelperProcess(t) {
    t && !t.killed && t.kill();
  }
  clearReadyState() {
    this.readyTimer && (clearTimeout(this.readyTimer), this.readyTimer = null), this.readyResolve = null, this.readyReject = null;
  }
  logDiagnostic(t, r) {
    console.info(
      "[cursor-native][win32]",
      JSON.stringify({
        event: t,
        ...r
      })
    );
  }
}
function ts(e) {
  return e.platform === "win32" ? new es({
    getDisplayBounds: e.getDisplayBounds,
    maxSamples: e.maxSamples,
    sampleIntervalMs: e.sampleIntervalMs,
    sourceId: e.sourceId,
    startTimeMs: e.startTimeMs
  }) : e.platform === "darwin" ? new vr({
    getDisplayBounds: e.getDisplayBounds,
    maxSamples: e.maxSamples,
    sampleIntervalMs: e.sampleIntervalMs,
    startTimeMs: e.startTimeMs
  }) : new Ja({
    getDisplayBounds: e.getDisplayBounds,
    maxSamples: e.maxSamples,
    sampleIntervalMs: e.sampleIntervalMs,
    startTimeMs: e.startTimeMs
  });
}
var jr = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {}, Kt = {}, Yt = { exports: {} }, Ir;
function Ut() {
  return Ir || (Ir = 1, (function(e) {
    var t, r, n, a, i, p, h, m, w, C, k, B, ae, Q, se, ee, Je, St, fe, l, o, s, c, S, x, v, g, A, j, _, N, R;
    (function(E) {
      var re = typeof jr == "object" ? jr : typeof self == "object" ? self : typeof this == "object" ? this : {};
      E(Be(re, Be(e.exports)));
      function Be(ie, ze) {
        return ie !== re && (typeof Object.create == "function" ? Object.defineProperty(ie, "__esModule", { value: !0 }) : ie.__esModule = !0), function(u, d) {
          return ie[u] = ze ? ze(u, d) : d;
        };
      }
    })(function(E) {
      var re = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(u, d) {
        u.__proto__ = d;
      } || function(u, d) {
        for (var f in d) Object.prototype.hasOwnProperty.call(d, f) && (u[f] = d[f]);
      };
      t = function(u, d) {
        if (typeof d != "function" && d !== null)
          throw new TypeError("Class extends value " + String(d) + " is not a constructor or null");
        re(u, d);
        function f() {
          this.constructor = u;
        }
        u.prototype = d === null ? Object.create(d) : (f.prototype = d.prototype, new f());
      }, r = Object.assign || function(u) {
        for (var d, f = 1, y = arguments.length; f < y; f++) {
          d = arguments[f];
          for (var P in d) Object.prototype.hasOwnProperty.call(d, P) && (u[P] = d[P]);
        }
        return u;
      }, n = function(u, d) {
        var f = {};
        for (var y in u) Object.prototype.hasOwnProperty.call(u, y) && d.indexOf(y) < 0 && (f[y] = u[y]);
        if (u != null && typeof Object.getOwnPropertySymbols == "function")
          for (var P = 0, y = Object.getOwnPropertySymbols(u); P < y.length; P++)
            d.indexOf(y[P]) < 0 && Object.prototype.propertyIsEnumerable.call(u, y[P]) && (f[y[P]] = u[y[P]]);
        return f;
      }, a = function(u, d, f, y) {
        var P = arguments.length, T = P < 3 ? d : y === null ? y = Object.getOwnPropertyDescriptor(d, f) : y, O;
        if (typeof Reflect == "object" && typeof Reflect.decorate == "function") T = Reflect.decorate(u, d, f, y);
        else for (var z = u.length - 1; z >= 0; z--) (O = u[z]) && (T = (P < 3 ? O(T) : P > 3 ? O(d, f, T) : O(d, f)) || T);
        return P > 3 && T && Object.defineProperty(d, f, T), T;
      }, i = function(u, d) {
        return function(f, y) {
          d(f, y, u);
        };
      }, p = function(u, d, f, y, P, T) {
        function O(Fe) {
          if (Fe !== void 0 && typeof Fe != "function") throw new TypeError("Function expected");
          return Fe;
        }
        for (var z = y.kind, X = z === "getter" ? "get" : z === "setter" ? "set" : "value", M = !d && u ? y.static ? u : u.prototype : null, H = d || (M ? Object.getOwnPropertyDescriptor(M, y.name) : {}), J, Xe = !1, W = f.length - 1; W >= 0; W--) {
          var te = {};
          for (var ne in y) te[ne] = ne === "access" ? {} : y[ne];
          for (var ne in y.access) te.access[ne] = y.access[ne];
          te.addInitializer = function(Fe) {
            if (Xe) throw new TypeError("Cannot add initializers after decoration has completed");
            T.push(O(Fe || null));
          };
          var ce = (0, f[W])(z === "accessor" ? { get: H.get, set: H.set } : H[X], te);
          if (z === "accessor") {
            if (ce === void 0) continue;
            if (ce === null || typeof ce != "object") throw new TypeError("Object expected");
            (J = O(ce.get)) && (H.get = J), (J = O(ce.set)) && (H.set = J), (J = O(ce.init)) && P.unshift(J);
          } else (J = O(ce)) && (z === "field" ? P.unshift(J) : H[X] = J);
        }
        M && Object.defineProperty(M, y.name, H), Xe = !0;
      }, h = function(u, d, f) {
        for (var y = arguments.length > 2, P = 0; P < d.length; P++)
          f = y ? d[P].call(u, f) : d[P].call(u);
        return y ? f : void 0;
      }, m = function(u) {
        return typeof u == "symbol" ? u : "".concat(u);
      }, w = function(u, d, f) {
        return typeof d == "symbol" && (d = d.description ? "[".concat(d.description, "]") : ""), Object.defineProperty(u, "name", { configurable: !0, value: f ? "".concat(f, " ", d) : d });
      }, C = function(u, d) {
        if (typeof Reflect == "object" && typeof Reflect.metadata == "function") return Reflect.metadata(u, d);
      }, k = function(u, d, f, y) {
        function P(T) {
          return T instanceof f ? T : new f(function(O) {
            O(T);
          });
        }
        return new (f || (f = Promise))(function(T, O) {
          function z(H) {
            try {
              M(y.next(H));
            } catch (J) {
              O(J);
            }
          }
          function X(H) {
            try {
              M(y.throw(H));
            } catch (J) {
              O(J);
            }
          }
          function M(H) {
            H.done ? T(H.value) : P(H.value).then(z, X);
          }
          M((y = y.apply(u, d || [])).next());
        });
      }, B = function(u, d) {
        var f = { label: 0, sent: function() {
          if (T[0] & 1) throw T[1];
          return T[1];
        }, trys: [], ops: [] }, y, P, T, O = Object.create((typeof Iterator == "function" ? Iterator : Object).prototype);
        return O.next = z(0), O.throw = z(1), O.return = z(2), typeof Symbol == "function" && (O[Symbol.iterator] = function() {
          return this;
        }), O;
        function z(M) {
          return function(H) {
            return X([M, H]);
          };
        }
        function X(M) {
          if (y) throw new TypeError("Generator is already executing.");
          for (; O && (O = 0, M[0] && (f = 0)), f; ) try {
            if (y = 1, P && (T = M[0] & 2 ? P.return : M[0] ? P.throw || ((T = P.return) && T.call(P), 0) : P.next) && !(T = T.call(P, M[1])).done) return T;
            switch (P = 0, T && (M = [M[0] & 2, T.value]), M[0]) {
              case 0:
              case 1:
                T = M;
                break;
              case 4:
                return f.label++, { value: M[1], done: !1 };
              case 5:
                f.label++, P = M[1], M = [0];
                continue;
              case 7:
                M = f.ops.pop(), f.trys.pop();
                continue;
              default:
                if (T = f.trys, !(T = T.length > 0 && T[T.length - 1]) && (M[0] === 6 || M[0] === 2)) {
                  f = 0;
                  continue;
                }
                if (M[0] === 3 && (!T || M[1] > T[0] && M[1] < T[3])) {
                  f.label = M[1];
                  break;
                }
                if (M[0] === 6 && f.label < T[1]) {
                  f.label = T[1], T = M;
                  break;
                }
                if (T && f.label < T[2]) {
                  f.label = T[2], f.ops.push(M);
                  break;
                }
                T[2] && f.ops.pop(), f.trys.pop();
                continue;
            }
            M = d.call(u, f);
          } catch (H) {
            M = [6, H], P = 0;
          } finally {
            y = T = 0;
          }
          if (M[0] & 5) throw M[1];
          return { value: M[0] ? M[1] : void 0, done: !0 };
        }
      }, ae = function(u, d) {
        for (var f in u) f !== "default" && !Object.prototype.hasOwnProperty.call(d, f) && j(d, u, f);
      }, j = Object.create ? (function(u, d, f, y) {
        y === void 0 && (y = f);
        var P = Object.getOwnPropertyDescriptor(d, f);
        (!P || ("get" in P ? !d.__esModule : P.writable || P.configurable)) && (P = { enumerable: !0, get: function() {
          return d[f];
        } }), Object.defineProperty(u, y, P);
      }) : (function(u, d, f, y) {
        y === void 0 && (y = f), u[y] = d[f];
      }), Q = function(u) {
        var d = typeof Symbol == "function" && Symbol.iterator, f = d && u[d], y = 0;
        if (f) return f.call(u);
        if (u && typeof u.length == "number") return {
          next: function() {
            return u && y >= u.length && (u = void 0), { value: u && u[y++], done: !u };
          }
        };
        throw new TypeError(d ? "Object is not iterable." : "Symbol.iterator is not defined.");
      }, se = function(u, d) {
        var f = typeof Symbol == "function" && u[Symbol.iterator];
        if (!f) return u;
        var y = f.call(u), P, T = [], O;
        try {
          for (; (d === void 0 || d-- > 0) && !(P = y.next()).done; ) T.push(P.value);
        } catch (z) {
          O = { error: z };
        } finally {
          try {
            P && !P.done && (f = y.return) && f.call(y);
          } finally {
            if (O) throw O.error;
          }
        }
        return T;
      }, ee = function() {
        for (var u = [], d = 0; d < arguments.length; d++)
          u = u.concat(se(arguments[d]));
        return u;
      }, Je = function() {
        for (var u = 0, d = 0, f = arguments.length; d < f; d++) u += arguments[d].length;
        for (var y = Array(u), P = 0, d = 0; d < f; d++)
          for (var T = arguments[d], O = 0, z = T.length; O < z; O++, P++)
            y[P] = T[O];
        return y;
      }, St = function(u, d, f) {
        if (f || arguments.length === 2) for (var y = 0, P = d.length, T; y < P; y++)
          (T || !(y in d)) && (T || (T = Array.prototype.slice.call(d, 0, y)), T[y] = d[y]);
        return u.concat(T || Array.prototype.slice.call(d));
      }, fe = function(u) {
        return this instanceof fe ? (this.v = u, this) : new fe(u);
      }, l = function(u, d, f) {
        if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
        var y = f.apply(u, d || []), P, T = [];
        return P = Object.create((typeof AsyncIterator == "function" ? AsyncIterator : Object).prototype), z("next"), z("throw"), z("return", O), P[Symbol.asyncIterator] = function() {
          return this;
        }, P;
        function O(W) {
          return function(te) {
            return Promise.resolve(te).then(W, J);
          };
        }
        function z(W, te) {
          y[W] && (P[W] = function(ne) {
            return new Promise(function(ce, Fe) {
              T.push([W, ne, ce, Fe]) > 1 || X(W, ne);
            });
          }, te && (P[W] = te(P[W])));
        }
        function X(W, te) {
          try {
            M(y[W](te));
          } catch (ne) {
            Xe(T[0][3], ne);
          }
        }
        function M(W) {
          W.value instanceof fe ? Promise.resolve(W.value.v).then(H, J) : Xe(T[0][2], W);
        }
        function H(W) {
          X("next", W);
        }
        function J(W) {
          X("throw", W);
        }
        function Xe(W, te) {
          W(te), T.shift(), T.length && X(T[0][0], T[0][1]);
        }
      }, o = function(u) {
        var d, f;
        return d = {}, y("next"), y("throw", function(P) {
          throw P;
        }), y("return"), d[Symbol.iterator] = function() {
          return this;
        }, d;
        function y(P, T) {
          d[P] = u[P] ? function(O) {
            return (f = !f) ? { value: fe(u[P](O)), done: !1 } : T ? T(O) : O;
          } : T;
        }
      }, s = function(u) {
        if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
        var d = u[Symbol.asyncIterator], f;
        return d ? d.call(u) : (u = typeof Q == "function" ? Q(u) : u[Symbol.iterator](), f = {}, y("next"), y("throw"), y("return"), f[Symbol.asyncIterator] = function() {
          return this;
        }, f);
        function y(T) {
          f[T] = u[T] && function(O) {
            return new Promise(function(z, X) {
              O = u[T](O), P(z, X, O.done, O.value);
            });
          };
        }
        function P(T, O, z, X) {
          Promise.resolve(X).then(function(M) {
            T({ value: M, done: z });
          }, O);
        }
      }, c = function(u, d) {
        return Object.defineProperty ? Object.defineProperty(u, "raw", { value: d }) : u.raw = d, u;
      };
      var Be = Object.create ? (function(u, d) {
        Object.defineProperty(u, "default", { enumerable: !0, value: d });
      }) : function(u, d) {
        u.default = d;
      }, ie = function(u) {
        return ie = Object.getOwnPropertyNames || function(d) {
          var f = [];
          for (var y in d) Object.prototype.hasOwnProperty.call(d, y) && (f[f.length] = y);
          return f;
        }, ie(u);
      };
      S = function(u) {
        if (u && u.__esModule) return u;
        var d = {};
        if (u != null) for (var f = ie(u), y = 0; y < f.length; y++) f[y] !== "default" && j(d, u, f[y]);
        return Be(d, u), d;
      }, x = function(u) {
        return u && u.__esModule ? u : { default: u };
      }, v = function(u, d, f, y) {
        if (f === "a" && !y) throw new TypeError("Private accessor was defined without a getter");
        if (typeof d == "function" ? u !== d || !y : !d.has(u)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
        return f === "m" ? y : f === "a" ? y.call(u) : y ? y.value : d.get(u);
      }, g = function(u, d, f, y, P) {
        if (y === "m") throw new TypeError("Private method is not writable");
        if (y === "a" && !P) throw new TypeError("Private accessor was defined without a setter");
        if (typeof d == "function" ? u !== d || !P : !d.has(u)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
        return y === "a" ? P.call(u, f) : P ? P.value = f : d.set(u, f), f;
      }, A = function(u, d) {
        if (d === null || typeof d != "object" && typeof d != "function") throw new TypeError("Cannot use 'in' operator on non-object");
        return typeof u == "function" ? d === u : u.has(d);
      }, _ = function(u, d, f) {
        if (d != null) {
          if (typeof d != "object" && typeof d != "function") throw new TypeError("Object expected.");
          var y, P;
          if (f) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            y = d[Symbol.asyncDispose];
          }
          if (y === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            y = d[Symbol.dispose], f && (P = y);
          }
          if (typeof y != "function") throw new TypeError("Object not disposable.");
          P && (y = function() {
            try {
              P.call(this);
            } catch (T) {
              return Promise.reject(T);
            }
          }), u.stack.push({ value: d, dispose: y, async: f });
        } else f && u.stack.push({ async: !0 });
        return d;
      };
      var ze = typeof SuppressedError == "function" ? SuppressedError : function(u, d, f) {
        var y = new Error(f);
        return y.name = "SuppressedError", y.error = u, y.suppressed = d, y;
      };
      N = function(u) {
        function d(T) {
          u.error = u.hasError ? new ze(T, u.error, "An error was suppressed during disposal.") : T, u.hasError = !0;
        }
        var f, y = 0;
        function P() {
          for (; f = u.stack.pop(); )
            try {
              if (!f.async && y === 1) return y = 0, u.stack.push(f), Promise.resolve().then(P);
              if (f.dispose) {
                var T = f.dispose.call(f.value);
                if (f.async) return y |= 2, Promise.resolve(T).then(P, function(O) {
                  return d(O), P();
                });
              } else y |= 1;
            } catch (O) {
              d(O);
            }
          if (y === 1) return u.hasError ? Promise.reject(u.error) : Promise.resolve();
          if (u.hasError) throw u.error;
        }
        return P();
      }, R = function(u, d) {
        return typeof u == "string" && /^\.\.?\//.test(u) ? u.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(f, y, P, T, O) {
          return y ? d ? ".jsx" : ".js" : P && (!T || !O) ? f : P + T + "." + O.toLowerCase() + "js";
        }) : u;
      }, E("__extends", t), E("__assign", r), E("__rest", n), E("__decorate", a), E("__param", i), E("__esDecorate", p), E("__runInitializers", h), E("__propKey", m), E("__setFunctionName", w), E("__metadata", C), E("__awaiter", k), E("__generator", B), E("__exportStar", ae), E("__createBinding", j), E("__values", Q), E("__read", se), E("__spread", ee), E("__spreadArrays", Je), E("__spreadArray", St), E("__await", fe), E("__asyncGenerator", l), E("__asyncDelegator", o), E("__asyncValues", s), E("__makeTemplateObject", c), E("__importStar", S), E("__importDefault", x), E("__classPrivateFieldGet", v), E("__classPrivateFieldSet", g), E("__classPrivateFieldIn", A), E("__addDisposableResource", _), E("__disposeResources", N), E("__rewriteRelativeImportExtension", R);
    });
  })(Yt)), Yt.exports;
}
var qe = {}, Jt = {}, Ze = {}, _r;
function vt() {
  if (_r) return Ze;
  _r = 1, Object.defineProperty(Ze, "__esModule", { value: !0 }), Ze.WebmBase = void 0;
  let e = class {
    constructor(r = "Unknown", n = 0) {
      this.name = r, this.start = n;
    }
    getType() {
      return "Unknown";
    }
    updateBySource() {
    }
    setSource(r) {
      this.source = r, this.updateBySource();
    }
    updateByData() {
    }
    setData(r) {
      this.data = r, this.updateByData();
    }
    getValue() {
      return this.data;
    }
    setValue(r) {
      this.setData(r);
    }
  };
  return Ze.WebmBase = e, Ze;
}
var Qe = {}, et = {}, tt = {}, Er;
function Sr() {
  if (Er) return tt;
  Er = 1, Object.defineProperty(tt, "__esModule", { value: !0 }), tt.SectionType = void 0;
  var e;
  return (function(t) {
    t.Container = "Container", t.Uint = "Uint", t.Int = "Int", t.Float = "Float", t.String = "String", t.Date = "Date", t.Binary = "Binary";
  })(e || (tt.SectionType = e = {})), tt;
}
var Mr;
function vn() {
  if (Mr) return et;
  Mr = 1, Object.defineProperty(et, "__esModule", { value: !0 }), et.sections = void 0;
  const e = Sr();
  return et.sections = {
    172351395: { name: "EBML", type: e.SectionType.Container },
    646: { name: "EBMLVersion", type: e.SectionType.Uint },
    759: { name: "EBMLReadVersion", type: e.SectionType.Uint },
    754: { name: "EBMLMaxIDLength", type: e.SectionType.Uint },
    755: { name: "EBMLMaxSizeLength", type: e.SectionType.Uint },
    642: { name: "DocType", type: e.SectionType.String },
    647: { name: "DocTypeVersion", type: e.SectionType.Uint },
    645: { name: "DocTypeReadVersion", type: e.SectionType.Uint },
    108: { name: "Void", type: e.SectionType.Binary },
    63: { name: "CRC-32", type: e.SectionType.Binary },
    190023271: { name: "SignatureSlot", type: e.SectionType.Container },
    16010: { name: "SignatureAlgo", type: e.SectionType.Uint },
    16026: { name: "SignatureHash", type: e.SectionType.Uint },
    16037: { name: "SignaturePublicKey", type: e.SectionType.Binary },
    16053: { name: "Signature", type: e.SectionType.Binary },
    15963: { name: "SignatureElements", type: e.SectionType.Container },
    15995: { name: "SignatureElementList", type: e.SectionType.Container },
    9522: { name: "SignedElement", type: e.SectionType.Binary },
    139690087: { name: "Segment", type: e.SectionType.Container },
    21863284: { name: "SeekHead", type: e.SectionType.Container },
    3515: { name: "Seek", type: e.SectionType.Container },
    5035: { name: "SeekID", type: e.SectionType.Binary },
    5036: { name: "SeekPosition", type: e.SectionType.Uint },
    88713574: { name: "Info", type: e.SectionType.Container },
    13220: { name: "SegmentUID", type: e.SectionType.Binary },
    13188: { name: "SegmentFilename", type: e.SectionType.String },
    1882403: { name: "PrevUID", type: e.SectionType.Binary },
    1868715: { name: "PrevFilename", type: e.SectionType.String },
    2013475: { name: "NextUID", type: e.SectionType.Binary },
    1999803: { name: "NextFilename", type: e.SectionType.String },
    1092: { name: "SegmentFamily", type: e.SectionType.Binary },
    10532: { name: "ChapterTranslate", type: e.SectionType.Container },
    10748: { name: "ChapterTranslateEditionUID", type: e.SectionType.Uint },
    10687: { name: "ChapterTranslateCodec", type: e.SectionType.Uint },
    10661: { name: "ChapterTranslateID", type: e.SectionType.Binary },
    710577: { name: "TimecodeScale", type: e.SectionType.Uint },
    1161: { name: "Duration", type: e.SectionType.Float },
    1121: { name: "DateUTC", type: e.SectionType.Date },
    15273: { name: "Title", type: e.SectionType.String },
    3456: { name: "MuxingApp", type: e.SectionType.String },
    5953: { name: "WritingApp", type: e.SectionType.String },
    // Intentionally don't recognize the Cluster section because it's large
    // 0xf43b675: { name: "Cluster", type: SectionType.Container },
    103: { name: "Timecode", type: e.SectionType.Uint },
    6228: { name: "SilentTracks", type: e.SectionType.Container },
    6359: { name: "SilentTrackNumber", type: e.SectionType.Uint },
    39: { name: "Position", type: e.SectionType.Uint },
    43: { name: "PrevSize", type: e.SectionType.Uint },
    35: { name: "SimpleBlock", type: e.SectionType.Binary },
    32: { name: "BlockGroup", type: e.SectionType.Container },
    33: { name: "Block", type: e.SectionType.Binary },
    34: { name: "BlockVirtual", type: e.SectionType.Binary },
    13729: { name: "BlockAdditions", type: e.SectionType.Container },
    38: { name: "BlockMore", type: e.SectionType.Container },
    110: { name: "BlockAddID", type: e.SectionType.Uint },
    37: { name: "BlockAdditional", type: e.SectionType.Binary },
    27: { name: "BlockDuration", type: e.SectionType.Uint },
    122: { name: "ReferencePriority", type: e.SectionType.Uint },
    123: { name: "ReferenceBlock", type: e.SectionType.Int },
    125: { name: "ReferenceVirtual", type: e.SectionType.Int },
    36: { name: "CodecState", type: e.SectionType.Binary },
    13730: { name: "DiscardPadding", type: e.SectionType.Int },
    14: { name: "Slices", type: e.SectionType.Container },
    104: { name: "TimeSlice", type: e.SectionType.Container },
    76: { name: "LaceNumber", type: e.SectionType.Uint },
    77: { name: "FrameNumber", type: e.SectionType.Uint },
    75: { name: "BlockAdditionID", type: e.SectionType.Uint },
    78: { name: "Delay", type: e.SectionType.Uint },
    79: { name: "SliceDuration", type: e.SectionType.Uint },
    72: { name: "ReferenceFrame", type: e.SectionType.Container },
    73: { name: "ReferenceOffset", type: e.SectionType.Uint },
    74: { name: "ReferenceTimeCode", type: e.SectionType.Uint },
    47: { name: "EncryptedBlock", type: e.SectionType.Binary },
    106212971: { name: "Tracks", type: e.SectionType.Container },
    46: { name: "TrackEntry", type: e.SectionType.Container },
    87: { name: "TrackNumber", type: e.SectionType.Uint },
    13253: { name: "TrackUID", type: e.SectionType.Uint },
    3: { name: "TrackType", type: e.SectionType.Uint },
    57: { name: "FlagEnabled", type: e.SectionType.Uint },
    8: { name: "FlagDefault", type: e.SectionType.Uint },
    5546: { name: "FlagForced", type: e.SectionType.Uint },
    28: { name: "FlagLacing", type: e.SectionType.Uint },
    11751: { name: "MinCache", type: e.SectionType.Uint },
    11768: { name: "MaxCache", type: e.SectionType.Uint },
    254851: { name: "DefaultDuration", type: e.SectionType.Uint },
    216698: { name: "DefaultDecodedFieldDuration", type: e.SectionType.Uint },
    209231: { name: "TrackTimecodeScale", type: e.SectionType.Float },
    4991: { name: "TrackOffset", type: e.SectionType.Int },
    5614: { name: "MaxBlockAdditionID", type: e.SectionType.Uint },
    4974: { name: "Name", type: e.SectionType.String },
    177564: { name: "Language", type: e.SectionType.String },
    6: { name: "CodecID", type: e.SectionType.String },
    9122: { name: "CodecPrivate", type: e.SectionType.Binary },
    362120: { name: "CodecName", type: e.SectionType.String },
    13382: { name: "AttachmentLink", type: e.SectionType.Uint },
    1742487: { name: "CodecSettings", type: e.SectionType.String },
    1785920: { name: "CodecInfoURL", type: e.SectionType.String },
    438848: { name: "CodecDownloadURL", type: e.SectionType.String },
    42: { name: "CodecDecodeAll", type: e.SectionType.Uint },
    12203: { name: "TrackOverlay", type: e.SectionType.Uint },
    5802: { name: "CodecDelay", type: e.SectionType.Uint },
    5819: { name: "SeekPreRoll", type: e.SectionType.Uint },
    9764: { name: "TrackTranslate", type: e.SectionType.Container },
    9980: { name: "TrackTranslateEditionUID", type: e.SectionType.Uint },
    9919: { name: "TrackTranslateCodec", type: e.SectionType.Uint },
    9893: { name: "TrackTranslateTrackID", type: e.SectionType.Binary },
    96: { name: "Video", type: e.SectionType.Container },
    26: { name: "FlagInterlaced", type: e.SectionType.Uint },
    5048: { name: "StereoMode", type: e.SectionType.Uint },
    5056: { name: "AlphaMode", type: e.SectionType.Uint },
    5049: { name: "OldStereoMode", type: e.SectionType.Uint },
    48: { name: "PixelWidth", type: e.SectionType.Uint },
    58: { name: "PixelHeight", type: e.SectionType.Uint },
    5290: { name: "PixelCropBottom", type: e.SectionType.Uint },
    5307: { name: "PixelCropTop", type: e.SectionType.Uint },
    5324: { name: "PixelCropLeft", type: e.SectionType.Uint },
    5341: { name: "PixelCropRight", type: e.SectionType.Uint },
    5296: { name: "DisplayWidth", type: e.SectionType.Uint },
    5306: { name: "DisplayHeight", type: e.SectionType.Uint },
    5298: { name: "DisplayUnit", type: e.SectionType.Uint },
    5299: { name: "AspectRatioType", type: e.SectionType.Uint },
    963876: { name: "ColourSpace", type: e.SectionType.Binary },
    1029411: { name: "GammaValue", type: e.SectionType.Float },
    230371: { name: "FrameRate", type: e.SectionType.Float },
    97: { name: "Audio", type: e.SectionType.Container },
    53: { name: "SamplingFrequency", type: e.SectionType.Float },
    14517: { name: "OutputSamplingFrequency", type: e.SectionType.Float },
    31: { name: "Channels", type: e.SectionType.Uint },
    15739: { name: "ChannelPositions", type: e.SectionType.Binary },
    8804: { name: "BitDepth", type: e.SectionType.Uint },
    98: { name: "TrackOperation", type: e.SectionType.Container },
    99: { name: "TrackCombinePlanes", type: e.SectionType.Container },
    100: { name: "TrackPlane", type: e.SectionType.Container },
    101: { name: "TrackPlaneUID", type: e.SectionType.Uint },
    102: { name: "TrackPlaneType", type: e.SectionType.Uint },
    105: { name: "TrackJoinBlocks", type: e.SectionType.Container },
    109: { name: "TrackJoinUID", type: e.SectionType.Uint },
    64: { name: "TrickTrackUID", type: e.SectionType.Uint },
    65: { name: "TrickTrackSegmentUID", type: e.SectionType.Binary },
    70: { name: "TrickTrackFlag", type: e.SectionType.Uint },
    71: { name: "TrickMasterTrackUID", type: e.SectionType.Uint },
    68: { name: "TrickMasterTrackSegmentUID", type: e.SectionType.Binary },
    11648: { name: "ContentEncodings", type: e.SectionType.Container },
    8768: { name: "ContentEncoding", type: e.SectionType.Container },
    4145: { name: "ContentEncodingOrder", type: e.SectionType.Uint },
    4146: { name: "ContentEncodingScope", type: e.SectionType.Uint },
    4147: { name: "ContentEncodingType", type: e.SectionType.Uint },
    4148: { name: "ContentCompression", type: e.SectionType.Container },
    596: { name: "ContentCompAlgo", type: e.SectionType.Uint },
    597: { name: "ContentCompSettings", type: e.SectionType.Binary },
    4149: { name: "ContentEncryption", type: e.SectionType.Container },
    2017: { name: "ContentEncAlgo", type: e.SectionType.Uint },
    2018: { name: "ContentEncKeyID", type: e.SectionType.Binary },
    2019: { name: "ContentSignature", type: e.SectionType.Binary },
    2020: { name: "ContentSigKeyID", type: e.SectionType.Binary },
    2021: { name: "ContentSigAlgo", type: e.SectionType.Uint },
    2022: { name: "ContentSigHashAlgo", type: e.SectionType.Uint },
    206814059: { name: "Cues", type: e.SectionType.Container },
    59: { name: "CuePoint", type: e.SectionType.Container },
    51: { name: "CueTime", type: e.SectionType.Uint },
    55: { name: "CueTrackPositions", type: e.SectionType.Container },
    119: { name: "CueTrack", type: e.SectionType.Uint },
    113: { name: "CueClusterPosition", type: e.SectionType.Uint },
    112: { name: "CueRelativePosition", type: e.SectionType.Uint },
    50: { name: "CueDuration", type: e.SectionType.Uint },
    4984: { name: "CueBlockNumber", type: e.SectionType.Uint },
    106: { name: "CueCodecState", type: e.SectionType.Uint },
    91: { name: "CueReference", type: e.SectionType.Container },
    22: { name: "CueRefTime", type: e.SectionType.Uint },
    23: { name: "CueRefCluster", type: e.SectionType.Uint },
    4959: { name: "CueRefNumber", type: e.SectionType.Uint },
    107: { name: "CueRefCodecState", type: e.SectionType.Uint },
    155296873: { name: "Attachments", type: e.SectionType.Container },
    8615: { name: "AttachedFile", type: e.SectionType.Container },
    1662: { name: "FileDescription", type: e.SectionType.String },
    1646: { name: "FileName", type: e.SectionType.String },
    1632: { name: "FileMimeType", type: e.SectionType.String },
    1628: { name: "FileData", type: e.SectionType.Binary },
    1710: { name: "FileUID", type: e.SectionType.Uint },
    1653: { name: "FileReferral", type: e.SectionType.Binary },
    1633: { name: "FileUsedStartTime", type: e.SectionType.Uint },
    1634: { name: "FileUsedEndTime", type: e.SectionType.Uint },
    4433776: { name: "Chapters", type: e.SectionType.Container },
    1465: { name: "EditionEntry", type: e.SectionType.Container },
    1468: { name: "EditionUID", type: e.SectionType.Uint },
    1469: { name: "EditionFlagHidden", type: e.SectionType.Uint },
    1499: { name: "EditionFlagDefault", type: e.SectionType.Uint },
    1501: { name: "EditionFlagOrdered", type: e.SectionType.Uint },
    54: { name: "ChapterAtom", type: e.SectionType.Container },
    13252: { name: "ChapterUID", type: e.SectionType.Uint },
    5716: { name: "ChapterStringUID", type: e.SectionType.String },
    17: { name: "ChapterTimeStart", type: e.SectionType.Uint },
    18: { name: "ChapterTimeEnd", type: e.SectionType.Uint },
    24: { name: "ChapterFlagHidden", type: e.SectionType.Uint },
    1432: { name: "ChapterFlagEnabled", type: e.SectionType.Uint },
    11879: { name: "ChapterSegmentUID", type: e.SectionType.Binary },
    11964: { name: "ChapterSegmentEditionUID", type: e.SectionType.Uint },
    9155: { name: "ChapterPhysicalEquiv", type: e.SectionType.Uint },
    15: { name: "ChapterTrack", type: e.SectionType.Container },
    9: { name: "ChapterTrackNumber", type: e.SectionType.Uint },
    0: { name: "ChapterDisplay", type: e.SectionType.Container },
    5: { name: "ChapString", type: e.SectionType.String },
    892: { name: "ChapLanguage", type: e.SectionType.String },
    894: { name: "ChapCountry", type: e.SectionType.String },
    10564: { name: "ChapProcess", type: e.SectionType.Container },
    10581: { name: "ChapProcessCodecID", type: e.SectionType.Uint },
    1293: { name: "ChapProcessPrivate", type: e.SectionType.Binary },
    10513: { name: "ChapProcessCommand", type: e.SectionType.Container },
    10530: { name: "ChapProcessTime", type: e.SectionType.Uint },
    10547: { name: "ChapProcessData", type: e.SectionType.Binary },
    39109479: { name: "Tags", type: e.SectionType.Container },
    13171: { name: "Tag", type: e.SectionType.Container },
    9152: { name: "Targets", type: e.SectionType.Container },
    10442: { name: "TargetTypeValue", type: e.SectionType.Uint },
    9162: { name: "TargetType", type: e.SectionType.String },
    9157: { name: "TagTrackUID", type: e.SectionType.Uint },
    9161: { name: "TagEditionUID", type: e.SectionType.Uint },
    9156: { name: "TagChapterUID", type: e.SectionType.Uint },
    9158: { name: "TagAttachmentUID", type: e.SectionType.Uint },
    10184: { name: "SimpleTag", type: e.SectionType.Container },
    1443: { name: "TagName", type: e.SectionType.String },
    1146: { name: "TagLanguage", type: e.SectionType.String },
    1156: { name: "TagDefault", type: e.SectionType.Uint },
    1159: { name: "TagString", type: e.SectionType.String },
    1157: { name: "TagBinary", type: e.SectionType.Binary },
    5552: { name: "Colour", type: e.SectionType.Container },
    5553: { name: "MatrixCoefficients", type: e.SectionType.Uint },
    5554: { name: "BitsPerChannel", type: e.SectionType.Uint },
    5555: { name: "ChromaSubsamplingHorz", type: e.SectionType.Uint },
    5556: { name: "ChromaSubsamplingVert", type: e.SectionType.Uint },
    5557: { name: "CbSubsamplingHorz", type: e.SectionType.Uint },
    5558: { name: "CbSubsamplingVert", type: e.SectionType.Uint },
    5559: { name: "ChromaSitingHorz", type: e.SectionType.Uint },
    5560: { name: "ChromaSitingVert", type: e.SectionType.Uint },
    5561: { name: "Range", type: e.SectionType.Uint },
    5562: { name: "TransferCharacteristics", type: e.SectionType.Uint },
    5563: { name: "Primaries", type: e.SectionType.Uint },
    5564: { name: "MaxCLL", type: e.SectionType.Uint },
    5565: { name: "MaxFALL", type: e.SectionType.Uint }
  }, et;
}
var rt = {}, kr;
function Sn() {
  if (kr) return rt;
  kr = 1, Object.defineProperty(rt, "__esModule", { value: !0 }), rt.WebmUint = void 0;
  const e = vt();
  function t(n) {
    return n.length % 2 === 1 ? "0" + n : n;
  }
  let r = class extends e.WebmBase {
    constructor(a, i = 0) {
      super(a, i);
    }
    getType() {
      return "Uint";
    }
    updateBySource() {
      this.data = "";
      for (let a = 0; a < this.source.length; a++) {
        const i = this.source[a].toString(16);
        this.data += t(i);
      }
    }
    updateByData() {
      const a = this.data.length / 2;
      this.source = new Uint8Array(a);
      for (let i = 0; i < a; i++) {
        const p = this.data.substring(i * 2, i * 2 + 2);
        this.source[i] = parseInt(p, 16);
      }
    }
    getValue() {
      return parseInt(this.data, 16);
    }
    setValue(a) {
      this.setData(t(a.toString(16)));
    }
  };
  return rt.WebmUint = r, rt;
}
var nt = {}, Rr;
function bn() {
  if (Rr) return nt;
  Rr = 1, Object.defineProperty(nt, "__esModule", { value: !0 }), nt.WebmFloat = void 0;
  const e = vt();
  let t = class extends e.WebmBase {
    constructor(n, a = 0) {
      super(n, a);
    }
    getType() {
      return "Float";
    }
    getFloatArrayType() {
      return this.source && this.source.length === 4 ? Float32Array : Float64Array;
    }
    updateBySource() {
      const n = this.source.reverse(), a = this.getFloatArrayType(), i = new a(n.buffer);
      this.data = i[0];
    }
    updateByData() {
      const n = this.getFloatArrayType(), a = new n([this.data]), i = new Uint8Array(a.buffer);
      this.source = i.reverse();
    }
  };
  return nt.WebmFloat = t, nt;
}
var ot = {}, Nr;
function Pn() {
  if (Nr) return ot;
  Nr = 1, Object.defineProperty(ot, "__esModule", { value: !0 }), ot.WebmString = void 0;
  const e = vt();
  let t = class extends e.WebmBase {
    constructor(n, a = 0) {
      super(n, a);
    }
    getType() {
      return "String";
    }
    updateBySource() {
      this.data = this.source;
    }
    updateByData() {
      this.source = this.data;
    }
    getValue() {
      let n = "";
      return this.source.forEach((a) => {
        n += String.fromCharCode(a);
      }), n;
    }
  };
  return ot.WebmString = t, ot;
}
var Vr;
function Tn() {
  if (Vr) return Qe;
  Vr = 1, Object.defineProperty(Qe, "__esModule", { value: !0 }), Qe.WebmContainer = void 0;
  const e = vt(), t = vn(), r = Sr(), n = Sn(), a = bn(), i = Pn();
  let p = class ur extends e.WebmBase {
    constructor(m, w = !1, C = 0) {
      super(m, C), this.isInfinite = w, this.offset = 0;
    }
    getType() {
      return "Container";
    }
    readByte() {
      return this.source[this.offset++];
    }
    readUint() {
      const m = this.readByte(), w = 8 - m.toString(2).length;
      let C = m - (1 << 7 - w);
      for (let k = 0; k < w; k++)
        C <<= 8, C |= this.readByte();
      return C;
    }
    updateBySource() {
      var m;
      this.data = [];
      let w;
      for (this.offset = 0; this.offset < this.source.length; this.offset = w) {
        const C = this.offset, k = this.readUint(), { name: B, type: ae } = (m = t.sections[k]) !== null && m !== void 0 ? m : {}, Q = this.readUint();
        w = this.source.length, Q >= 0 && (w = Math.min(this.offset + Q, w));
        const se = this.source.slice(this.offset, w);
        let ee;
        switch (ae) {
          case r.SectionType.Container:
            ee = new ur(B, Q < 0, C);
            break;
          case r.SectionType.Uint:
            ee = new n.WebmUint(B, C);
            break;
          case r.SectionType.Float:
            ee = new a.WebmFloat(B, C);
            break;
          case r.SectionType.String:
            ee = new i.WebmString(B, C);
            break;
          default:
            ee = new e.WebmBase(B, C);
            break;
        }
        ee.setSource(se), this.data.push({
          id: k,
          idHex: k.toString(16),
          data: ee
        });
      }
    }
    writeUint(m, w = !1) {
      let C;
      for (C = 1; (m < 0 || m >= 1 << 7 * C) && C < 8; C++)
        ;
      if (!w) {
        for (let k = 0; k < C; k++)
          this.source[this.offset + k] = m >> 8 * (C - 1 - k) & 255;
        this.source[this.offset] &= (1 << 8 - C) - 1, this.source[this.offset] |= 1 << 8 - C;
      }
      this.offset += C;
    }
    writeSections(m = !1) {
      this.offset = 0;
      for (let w = 0; w < this.data.length; w++) {
        const C = this.data[w], k = C.data.source, B = k.length;
        this.writeUint(C.id, m), this.writeUint(C.data instanceof ur && C.data.isInfinite ? -1 : B, m), m || this.source.set(k, this.offset), this.offset += B;
      }
      return this.offset;
    }
    updateByData() {
      const m = this.writeSections(!0);
      this.source = new Uint8Array(m), this.writeSections();
    }
    getSectionById(m) {
      for (let w = 0; w < this.data.length; w++) {
        const C = this.data[w];
        if (C.id === m)
          return C.data;
      }
      return null;
    }
  };
  return Qe.WebmContainer = p, Qe;
}
var at = {}, Br;
function rs() {
  if (Br) return at;
  Br = 1, Object.defineProperty(at, "__esModule", { value: !0 }), at.WebmFile = void 0;
  const e = /* @__PURE__ */ Ut(), t = Tn();
  let r = class dr extends t.WebmContainer {
    constructor(a) {
      super("File"), this.setSource(a);
    }
    getType() {
      return "File";
    }
    toBlob(a = "video/webm") {
      return new Blob([this.source.buffer], { type: a });
    }
    static blobToArray(a) {
      return new Promise((i, p) => {
        try {
          const h = new FileReader();
          h.onloadend = () => {
            try {
              i(new Uint8Array(h.result));
            } catch (m) {
              p(m);
            }
          }, h.readAsArrayBuffer(a);
        } catch (h) {
          p(h);
        }
      });
    }
    static fromBlob(a) {
      return e.__awaiter(this, void 0, void 0, function* () {
        const i = yield dr.blobToArray(a);
        return new dr(i);
      });
    }
  };
  return at.WebmFile = r, at;
}
var Xt = {}, zr;
function ns() {
  return zr || (zr = 1, Object.defineProperty(Xt, "__esModule", { value: !0 })), Xt;
}
var Ur;
function br() {
  return Ur || (Ur = 1, (function(e) {
    Object.defineProperty(e, "__esModule", { value: !0 });
    const t = /* @__PURE__ */ Ut();
    t.__exportStar(vt(), e), t.__exportStar(Tn(), e), t.__exportStar(rs(), e), t.__exportStar(bn(), e), t.__exportStar(Pn(), e), t.__exportStar(Sn(), e), t.__exportStar(Sr(), e), t.__exportStar(ns(), e), t.__exportStar(vn(), e);
  })(Jt)), Jt;
}
var st = {}, Wr;
function xn() {
  if (Wr) return st;
  Wr = 1, Object.defineProperty(st, "__esModule", { value: !0 }), st.fixParsedWebmDuration = void 0;
  const e = br(), t = (r, n, a = {}) => {
    let i = a.logger;
    i === void 0 ? i = (C) => console.debug(C) : i || (i = () => {
    });
    const p = r.getSectionById(139690087);
    if (!p)
      return i("[fix-webm-duration] Segment section is missing"), !1;
    const h = p.getSectionById(88713574);
    if (!h)
      return i("[fix-webm-duration] Info section is missing"), !1;
    const m = h.getSectionById(710577);
    if (!m)
      return i("[fix-webm-duration] TimecodeScale section is missing"), !1;
    let w = h.getSectionById(1161);
    if (w)
      if (w.getValue() <= 0)
        i(`[fix-webm-duration] Duration section is present, but the value is ${w.getValue()}`), w.setValue(n);
      else
        return i(`[fix-webm-duration] Duration section is present, and the value is ${w.getValue()}`), !1;
    else
      i("[fix-webm-duration] Duration section is missing"), w = new e.WebmFloat("Duration"), w.setValue(n), h.data.push({
        id: 1161,
        data: w
      });
    return m.setValue(1e6), h.updateByData(), p.updateByData(), r.updateByData(), !0;
  };
  return st.fixParsedWebmDuration = t, st;
}
var Lr;
function os() {
  if (Lr) return qe;
  Lr = 1, Object.defineProperty(qe, "__esModule", { value: !0 }), qe.fixWebmDuration = void 0;
  const e = /* @__PURE__ */ Ut(), t = br(), r = xn(), n = (a, i, p) => e.__awaiter(void 0, void 0, void 0, function* () {
    try {
      const h = yield t.WebmFile.fromBlob(a);
      if ((0, r.fixParsedWebmDuration)(h, i, p))
        return h.toBlob(a.type);
    } catch {
    }
    return a;
  });
  return qe.fixWebmDuration = n, qe;
}
var $r;
function as() {
  return $r || ($r = 1, (function(e) {
    Object.defineProperty(e, "__esModule", { value: !0 });
    const t = /* @__PURE__ */ Ut();
    t.__exportStar(os(), e), t.__exportStar(xn(), e);
  })(Kt)), Kt;
}
var ss = as(), is = br();
async function Gr(e, t) {
  try {
    const r = await D.readFile(e), n = new is.WebmFile(new Uint8Array(r));
    if (!ss.fixParsedWebmDuration(n, t, { logger: !1 })) {
      const h = cs(n);
      return h === "no-section" && console.warn(
        `[webm-duration] no Segment/Info section in ${e}; file may be truncated`
      ), { patched: !1, reason: h };
    }
    if (!n.source)
      return console.error(`[webm-duration] patched but source missing for ${e}`), { patched: !1, reason: "internal" };
    const i = `${e}.duration-patch.tmp`, p = Buffer.from(
      n.source.buffer,
      n.source.byteOffset,
      n.source.byteLength
    );
    try {
      return await D.writeFile(i, p), await D.rename(i, e), { patched: !0 };
    } catch (h) {
      return console.error(`[webm-duration] failed to write patched ${e}:`, h), await D.unlink(i).catch(() => {
      }), { patched: !1, reason: "io-error" };
    }
  } catch (r) {
    return console.error(`[webm-duration] failed to patch ${e}:`, r), { patched: !1, reason: "io-error" };
  }
}
function cs(e) {
  const t = e.getSectionById?.(139690087);
  return t && t.getSectionById?.(88713574) ? "already-valid" : "no-section";
}
const Hr = "native-bridge:invoke", Cn = 1;
class ls {
  constructor(t) {
    this.options = t;
  }
  options;
  kind = "none";
  async getCapabilities() {
    return {
      telemetry: !0,
      systemAssets: !1,
      provider: this.kind
    };
  }
  async getRecordingData(t) {
    const r = this.options.resolveVideoPath(t);
    return r ? this.options.loadRecordingData(r) : {
      version: 2,
      provider: this.kind,
      samples: [],
      assets: []
    };
  }
  async getTelemetry(t) {
    const r = this.options.resolveVideoPath(t);
    return r ? this.options.loadTelemetry(r) : {
      success: !1,
      message: "No video path is available for cursor telemetry",
      samples: []
    };
  }
}
class us {
  constructor(t) {
    this.options = t;
  }
  options;
  async getCapabilities() {
    const t = await this.options.adapter.getCapabilities();
    return this.options.store.setCursorCapabilities(t), t;
  }
  async getTelemetry(t) {
    const r = await this.options.adapter.getTelemetry(t);
    if (!r.success)
      throw new Error(r.message || r.error || "Failed to load cursor telemetry");
    const n = t ?? this.options.store.getState().project.currentVideoPath;
    return n && this.options.store.markCursorTelemetryLoaded(n, r.samples.length), r.samples;
  }
  async getRecordingData(t) {
    const r = await this.options.adapter.getRecordingData(t), n = t ?? this.options.store.getState().project.currentVideoPath;
    return n && this.options.store.markCursorTelemetryLoaded(n, r.samples.length), r;
  }
}
class ds {
  constructor(t) {
    this.options = t;
  }
  options;
  getCurrentContext() {
    const t = {
      currentProjectPath: this.options.getCurrentProjectPath(),
      currentVideoPath: this.options.getCurrentVideoPath()
    };
    return this.options.store.setProjectContext(t), t;
  }
  async saveProjectFile(t, r, n) {
    const a = await this.options.saveProjectFile(
      t,
      r,
      n
    );
    return this.getCurrentContext(), a;
  }
  async loadProjectFile(t) {
    const r = await this.options.loadProjectFile(t);
    return this.getCurrentContext(), r;
  }
  async loadCurrentProjectFile() {
    const t = await this.options.loadCurrentProjectFile();
    return this.getCurrentContext(), t;
  }
  async loadProjectFileFromPath(t) {
    const r = await this.options.loadProjectFileFromPath(t);
    return this.getCurrentContext(), r;
  }
  async setCurrentVideoPath(t) {
    const r = await this.options.setCurrentVideoPath(t);
    return this.getCurrentContext(), r;
  }
  getCurrentVideoPath() {
    const t = this.options.getCurrentVideoPathResult();
    return this.getCurrentContext(), t;
  }
  clearCurrentVideoPath() {
    const t = this.options.clearCurrentVideoPath();
    return this.getCurrentContext(), t;
  }
}
class ps {
  constructor(t) {
    this.options = t;
  }
  options;
  getPlatform() {
    return this.options.getPlatform();
  }
  getAssetBasePath() {
    return this.options.getAssetBasePath();
  }
  async getCapabilities() {
    const t = this.getPlatform(), r = await this.options.getCursorCapabilities(), n = {
      bridgeVersion: Cn,
      platform: t,
      cursor: r,
      project: {
        currentContext: !0
      }
    };
    return this.options.store.setSystemCapabilities(n), n;
  }
}
class ms {
  state;
  constructor(t) {
    this.state = {
      system: {
        platform: t,
        capabilities: null
      },
      project: {
        currentProjectPath: null,
        currentVideoPath: null
      },
      cursor: {
        capabilities: null,
        lastTelemetryLoad: null
      }
    };
  }
  getState() {
    return this.state;
  }
  setProjectContext(t) {
    this.state = {
      ...this.state,
      project: t
    };
  }
  setSystemCapabilities(t) {
    this.state = {
      ...this.state,
      system: {
        ...this.state.system,
        capabilities: t
      }
    };
  }
  setCursorCapabilities(t) {
    this.state = {
      ...this.state,
      cursor: {
        ...this.state.cursor,
        capabilities: t
      }
    };
  }
  markCursorTelemetryLoaded(t, r) {
    this.state = {
      ...this.state,
      cursor: {
        ...this.state.cursor,
        lastTelemetryLoad: {
          videoPath: t,
          sampleCount: r,
          loadedAt: Date.now()
        }
      }
    };
  }
}
function fs(e) {
  return e === "darwin" || e === "win32" ? e : "linux";
}
function Fn(e) {
  return {
    version: Cn,
    requestId: e || `native-${Date.now()}`,
    timestampMs: Date.now()
  };
}
function q(e, t) {
  return {
    ok: !0,
    data: t,
    meta: Fn(e)
  };
}
function Ue(e, t, r, n = !1) {
  return {
    ok: !1,
    error: {
      code: t,
      message: r,
      retryable: n
    },
    meta: Fn(e)
  };
}
function hs(e) {
  if (!e || typeof e != "object")
    return !1;
  const t = e;
  return typeof t.domain == "string" && typeof t.action == "string";
}
function ys(e) {
  F.removeHandler(Hr);
  const t = fs(e.getPlatform()), r = new ms(t), n = new ds({
    store: r,
    getCurrentProjectPath: e.getCurrentProjectPath,
    getCurrentVideoPath: e.getCurrentVideoPath,
    saveProjectFile: e.saveProjectFile,
    loadProjectFile: e.loadProjectFile,
    loadCurrentProjectFile: e.loadCurrentProjectFile,
    loadProjectFileFromPath: e.loadProjectFileFromPath,
    setCurrentVideoPath: e.setCurrentVideoPath,
    getCurrentVideoPathResult: e.getCurrentVideoPathResult,
    clearCurrentVideoPath: e.clearCurrentVideoPath
  }), a = new us({
    store: r,
    adapter: new ls({
      loadRecordingData: e.loadCursorRecordingData,
      resolveVideoPath: e.resolveVideoPath,
      loadTelemetry: e.loadCursorTelemetry
    })
  }), i = new ps({
    store: r,
    getPlatform: () => t,
    getAssetBasePath: e.resolveAssetBasePath,
    getCursorCapabilities: () => a.getCapabilities()
  });
  F.handle(Hr, async (p, h) => {
    if (!hs(h))
      return Ue(void 0, "INVALID_REQUEST", "Invalid native bridge request.");
    const m = h.requestId, w = h.domain;
    try {
      switch (h.domain) {
        case "system": {
          const C = h.action;
          switch (h.action) {
            case "getPlatform":
              return q(m, i.getPlatform());
            case "getAssetBasePath":
              return q(m, i.getAssetBasePath());
            case "getCapabilities":
              return q(m, await i.getCapabilities());
            default:
              return Ue(
                m,
                "UNSUPPORTED_ACTION",
                `Unsupported system action: ${C}`
              );
          }
        }
        case "project": {
          const C = h.action;
          switch (h.action) {
            case "getCurrentContext":
              return q(m, n.getCurrentContext());
            case "saveProjectFile":
              return q(
                m,
                await n.saveProjectFile(
                  h.payload.projectData,
                  h.payload.suggestedName,
                  h.payload.existingProjectPath
                )
              );
            case "loadProjectFile":
              return q(
                m,
                await n.loadProjectFile(h.payload?.projectFolder)
              );
            case "loadCurrentProjectFile":
              return q(
                m,
                await n.loadCurrentProjectFile()
              );
            case "loadProjectFileFromPath":
              return q(
                m,
                await n.loadProjectFileFromPath(h.payload.path)
              );
            case "setCurrentVideoPath":
              return q(
                m,
                await n.setCurrentVideoPath(h.payload.path)
              );
            case "getCurrentVideoPath":
              return q(m, n.getCurrentVideoPath());
            case "clearCurrentVideoPath":
              return q(m, n.clearCurrentVideoPath());
            default:
              return Ue(
                m,
                "UNSUPPORTED_ACTION",
                `Unsupported project action: ${C}`
              );
          }
        }
        case "cursor": {
          const C = h.action;
          switch (h.action) {
            case "getCapabilities":
              return q(m, await a.getCapabilities());
            case "getTelemetry":
              return q(
                m,
                await a.getTelemetry(h.payload?.videoPath)
              );
            case "getRecordingData":
              return q(
                m,
                await a.getRecordingData(h.payload?.videoPath)
              );
            default:
              return Ue(
                m,
                "UNSUPPORTED_ACTION",
                `Unsupported cursor action: ${C}`
              );
          }
        }
        default:
          return Ue(
            m,
            "UNSUPPORTED_ACTION",
            `Unsupported bridge domain: ${w}`
          );
      }
    } catch (C) {
      return Ue(
        m,
        "INTERNAL_ERROR",
        C instanceof Error ? C.message : "Unknown native bridge error.",
        !0
      );
    }
  });
}
function Dn(e) {
  const t = [], r = e.split(/\n----\n/g).slice(1);
  for (const n of r) {
    if (!/^Data format:/m.test(n) || !/\baudio packets:/i.test(n)) continue;
    const a = n.match(/\bbit rate:\s*([0-9]+)\s*bits per second/i);
    t.push(a ? Number(a[1]) : 0);
  }
  return t;
}
function gs(e, t) {
  if (typeof t == "number") {
    const n = Math.round(t);
    return n >= 0 && n < e.length ? n : null;
  }
  if (e.length <= 1)
    return null;
  let r = 1;
  for (let n = 2; n < e.length; n += 1)
    e[n] > e[r] && (r = n);
  return r;
}
function ws(e, t, r) {
  const n = e.get(t);
  if (n) return n;
  let a;
  return a = Promise.resolve().then(r).finally(() => {
    e.get(t) === a && e.delete(t);
  }), e.set(t, a), a;
}
class vs {
  streams = /* @__PURE__ */ new Map();
  /**
   * Open a write stream, resolving only on the `open` event so a bad path or
   * permission error rejects here instead of becoming a silent chunk drop later,
   * letting the renderer's fallback take over.
   */
  async open(t, r) {
    await this.endStream(t);
    const n = Jn(r, { flags: "w" });
    await new Promise((a, i) => {
      const p = (h) => i(h);
      n.once("error", p), n.once("open", () => {
        n.removeListener("error", p), a();
      });
    }), n.on("error", (a) => {
      console.error(`[recording-stream] ${t}:`, a);
    }), this.streams.set(t, n);
  }
  has(t) {
    return this.streams.has(t);
  }
  /** Append a chunk; rejects if no stream is open or the write fails. */
  async append(t, r) {
    const n = this.streams.get(t);
    if (!n)
      throw new Error(`No active recording stream for ${t}`);
    await new Promise((a, i) => {
      n.write(r, (p) => p ? i(p) : a());
    });
  }
  /**
   * Flush and close the stream, keeping the file. Returns true if a stream was
   * open (streamed to disk) or false if the caller still needs to write its buffer.
   */
  async finalize(t) {
    const r = this.streams.get(t);
    return r ? (this.streams.delete(t), await new Promise((n, a) => {
      r.end((i) => i ? a(i) : n());
    }), !0) : !1;
  }
  /**
   * Close the stream (if any) and delete the partial file, so a discarded or
   * failed recording doesn't leak descriptors or orphan partial files on disk.
   */
  async discard(t, r) {
    await this.endStream(t), await Ln(r).catch(() => {
    });
  }
  async endStream(t) {
    const r = this.streams.get(t);
    r && (this.streams.delete(t), await new Promise((n) => r.end(() => n())));
  }
}
function Ss(e, t, r) {
  e.handle(
    "open-recording-stream",
    async (n, a) => {
      try {
        return await t.open(a, r(a)), { success: !0 };
      } catch (i) {
        return { success: !1, error: String(i) };
      }
    }
  ), e.handle(
    "append-recording-chunk",
    async (n, a, i) => {
      try {
        return await t.append(a, Buffer.from(i)), { success: !0 };
      } catch (p) {
        return { success: !1, error: String(p) };
      }
    }
  ), e.handle(
    "close-recording-stream",
    async (n, a) => {
      try {
        return await t.discard(a, r(a)), { success: !0 };
      } catch (i) {
        return { success: !1, error: String(i) };
      }
    }
  );
}
const it = "openscreen", pr = b.join(V.getPath("userData"), "shortcuts.json"), Ct = "recording-", $e = ".session.json", bs = /* @__PURE__ */ new Set([
  ".webm",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".m4v",
  ".wmv",
  ".flv",
  ".ts"
]), mr = b.join(V.getPath("userData"), "preview-audio"), fr = b.join(V.getPath("userData"), "voiceover"), Nt = b.join(V.getPath("userData"), "openai-api-key.bin"), Pr = b.join(V.getPath("userData"), "openai-api-key.local.json"), xe = new Hn(), Ps = /* @__PURE__ */ new Map(), An = /* @__PURE__ */ new Set(), Vt = /* @__PURE__ */ new Map();
let ct = null, qt = 0;
async function Ts() {
  return ct?.listening || (ct = qn(async (e, t) => {
    const r = e.url?.split("/media/")[1]?.split(/[?#]/, 1)[0], n = r ? Vt.get(r) : null;
    if (!n || n.expiresAt < Date.now()) {
      r && Vt.delete(r), t.writeHead(404).end();
      return;
    }
    try {
      const a = await D.stat(n.filePath), i = e.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
      let p = 0, h = Math.max(0, a.size - 1);
      if (i) {
        if (p = i[1] ? Number.parseInt(i[1], 10) : 0, h = i[2] ? Number.parseInt(i[2], 10) : h, p > h || p >= a.size) {
          t.writeHead(416, { "Content-Range": `bytes */${a.size}` }).end();
          return;
        }
        h = Math.min(h, a.size - 1);
      }
      const m = {
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Content-Length": String(h - p + 1),
        "Content-Type": "application/octet-stream"
      };
      i && (m["Content-Range"] = `bytes ${p}-${h}/${a.size}`), t.writeHead(i ? 206 : 200, m), Xn(n.filePath, { start: p, end: h }).pipe(t);
    } catch {
      t.writeHead(500).end();
    }
  }), await new Promise((e, t) => {
    ct.once("error", t), ct.listen(0, "127.0.0.1", () => {
      const r = ct.address();
      qt = typeof r == "object" && r ? r.port : 0, e();
    });
  })), qt;
}
function Bt(e) {
  An.add(b.resolve(e));
}
function xs() {
  return [U, mr, fr];
}
function Wt(e, t) {
  const r = b.resolve(e), n = b.resolve(t);
  return r === n || r.startsWith(n + b.sep);
}
function Te(e) {
  const t = b.resolve(e);
  return An.has(t) ? !0 : xs().some((r) => Wt(t, r));
}
const zt = "openscreen-local-key-pad";
function Cs(e) {
  const t = Buffer.from(e, "utf8");
  for (let r = 0; r < t.length; r++)
    t[r] ^= zt.charCodeAt(r % zt.length);
  return t.toString("base64");
}
function Fs(e) {
  const t = Buffer.from(e, "base64");
  for (let r = 0; r < t.length; r++)
    t[r] ^= zt.charCodeAt(r % zt.length);
  return t.toString("utf8");
}
async function lt() {
  if (Ie.isEncryptionAvailable())
    try {
      const e = await D.readFile(Nt), t = Ie.decryptString(e).trim();
      if (t) return t;
    } catch {
    }
  try {
    const e = JSON.parse(await D.readFile(Pr, "utf8")), t = typeof e.key == "string" ? Fs(e.key).trim() : "";
    return t ? (Ie.isEncryptionAvailable() && await D.writeFile(Nt, Ie.encryptString(t), { mode: 384 }).catch(() => {
    }), t) : null;
  } catch {
    return null;
  }
}
async function Ds(e) {
  const t = e.trim();
  return !t.startsWith("sk-") || t.length < 20 ? { success: !1, message: "Enter a valid OpenAI API key." } : (await D.writeFile(Pr, JSON.stringify({ key: Cs(t) }), {
    mode: 384
  }), Ie.isEncryptionAvailable() && await D.writeFile(Nt, Ie.encryptString(t), { mode: 384 }), { success: !0 });
}
function As(e) {
  const t = ve(e);
  return !t || !On(t) || !Te(t) ? null : t;
}
function Ft(e, t) {
  const r = t;
  return r && !r.isDestroyed() ? { ...e, parent: r } : e;
}
function On(e) {
  return bs.has(b.extname(e).toLowerCase());
}
function ht(e, t, r) {
  return new Promise((n, a) => {
    const i = Ve(e, t, { stdio: ["ignore", "pipe", "pipe"] });
    let p = "", h = "", m = !1;
    const w = r?.timeoutMs ? setTimeout(() => {
      m = !0, i.kill("SIGKILL");
    }, r.timeoutMs) : null;
    i.stdout.on("data", (C) => {
      p += C.toString();
    }), i.stderr.on("data", (C) => {
      h += C.toString();
    }), i.on("error", (C) => {
      w && clearTimeout(w), a(C);
    }), i.on("close", (C) => {
      w && clearTimeout(w), n({ code: C, stdout: p, stderr: h, timedOut: m });
    });
  });
}
async function Os(e, t) {
  const r = await pe(e);
  if (!r)
    return {
      success: !1,
      message: "File path is not approved or is not a supported video file"
    };
  if (process.platform !== "darwin" || b.extname(r).toLowerCase() !== ".mp4")
    return { success: !0, path: null };
  const n = await ht("/usr/bin/afinfo", [r]);
  if (n.code !== 0)
    return { success: !0, path: null };
  const a = Dn(`${n.stdout}
${n.stderr}`), i = gs(
    a,
    t
  );
  if (i === null)
    return { success: !0, path: null };
  const p = `${r}\0${i}`;
  return ws(
    Ps,
    p,
    async () => {
      await D.mkdir(mr, { recursive: !0 });
      const h = await D.stat(r), m = b.parse(r), w = pn("sha256").update(r).digest("hex").slice(0, 12), C = b.join(
        mr,
        `${m.name}.${w}.track-${i + 1}.${Math.round(h.mtimeMs)}.m4a`
      );
      try {
        const B = await D.stat(C), ae = await ht("/usr/bin/afinfo", [C]);
        if (B.mtimeMs >= h.mtimeMs && ae.code === 0)
          return { success: !0, path: Ge(C).toString() };
      } catch {
      }
      const k = `${C}.${cr()}.tmp.m4a`;
      try {
        const B = await ht("/usr/bin/afconvert", [
          "--read-track",
          String(i),
          "-f",
          "m4af",
          "-d",
          "aac",
          r,
          k
        ]);
        if (B.code !== 0)
          return {
            success: !1,
            message: B.stderr || B.stdout || "Failed to prepare preview audio"
          };
        await D.rename(k, C);
      } finally {
        await D.rm(k, { force: !0 }).catch(() => {
        });
      }
      return { success: !0, path: Ge(C).toString() };
    }
  );
}
async function pe(e, t) {
  const r = ve(e);
  if (!r)
    return null;
  if (Te(r))
    return r;
  if (!On(r))
    return null;
  if (t) {
    const n = b.resolve(r);
    if (!t.some((i) => Wt(n, i)))
      return null;
  }
  try {
    if (!(await D.stat(r)).isFile())
      return null;
  } catch {
    return null;
  }
  return Bt(r), r;
}
function Dt(e) {
  const t = e.trim();
  if (!t)
    throw new Error("Invalid recording file name");
  const r = b.parse(t), n = t.split(/[\\/]+/).some((i) => i === ".."), a = r.dir !== "" || b.isAbsolute(t) || t.includes("/") || t.includes("\\");
  if (n || a || r.base !== t)
    throw new Error("Recording file name must not contain path segments");
  return b.join(U, r.base);
}
function At(e) {
  return typeof e == "number" && Number.isFinite(e) && e > 0;
}
async function Kr(e, t, r, n) {
  const a = await e.finalize(t);
  return !a && n && n.byteLength > 0 && await D.writeFile(r, Buffer.from(n)), a;
}
async function Zt(e, t) {
  if (!e || typeof e != "object")
    return null;
  const r = e, n = fn(r.media) ?? (typeof r.videoPath == "string" ? {
    screenVideoPath: ve(r.videoPath) ?? r.videoPath
  } : null);
  if (!n)
    return null;
  const a = [U];
  t && a.push(b.dirname(b.resolve(t)));
  const i = await pe(n.screenVideoPath, a);
  if (!i)
    throw new Error("Project references an invalid or unsupported screen video path");
  const p = n.webcamVideoPath ? await pe(n.webcamVideoPath, a) : void 0;
  if (n.webcamVideoPath && !p)
    throw new Error("Project references an invalid or unsupported webcam video path");
  return {
    screenVideoPath: i,
    ...p ? { webcamVideoPath: p } : {},
    ...n.webcamSync ? { webcamSync: n.webcamSync } : {},
    ...n.cursorCaptureMode ? { cursorCaptureMode: n.cursorCaptureMode } : {},
    ...n.audioTracks?.length ? { audioTracks: n.audioTracks } : {},
    ...n.audioStreams?.length ? { audioStreams: n.audioStreams } : {},
    createdAt: Date.now()
  };
}
let Z = null, dt = null, Ot = /* @__PURE__ */ new Map(), Y = null, le = null;
function js() {
  return dt;
}
let ge = null;
function yt(e) {
  return b.resolve(e);
}
function ve(e) {
  if (typeof e != "string")
    return null;
  const t = e.trim();
  if (!t)
    return null;
  if (/^file:\/\//i.test(t))
    try {
      return wr(t);
    } catch {
    }
  return t;
}
function Is(e) {
  return !e || !Y ? !1 : yt(e) === yt(Y);
}
const _s = 2, Es = 33, Ms = 3600 * 30;
let de = null, $ = null, he = null, me = "", _e = null, jt = null, It = null, We = 0, _t = "editable-overlay", Ee = 0, Me = null, pt = [], Ae = !1;
const ks = 15e3;
let ye = null, He = "", Se = null, Et = null, Mt = null, ut = 0, kt = "editable-overlay", ke = 0, Re = null, mt = [], Oe = !1;
function Rs(e) {
  if (!e || typeof e != "object")
    return null;
  const t = e, r = t.interactionType === "click" || t.interactionType === "mouseup" || t.interactionType === "move" ? t.interactionType : "move";
  return {
    timeMs: typeof t.timeMs == "number" && Number.isFinite(t.timeMs) ? Math.max(0, t.timeMs) : 0,
    cx: typeof t.cx == "number" && Number.isFinite(t.cx) ? t.cx : 0.5,
    cy: typeof t.cy == "number" && Number.isFinite(t.cy) ? t.cy : 0.5,
    assetId: typeof t.assetId == "string" ? t.assetId : null,
    visible: typeof t.visible == "boolean" ? t.visible : !0,
    cursorType: typeof t.cursorType == "string" ? t.cursorType : null,
    interactionType: r
  };
}
function Ns(e) {
  if (!e || typeof e != "object")
    return null;
  const t = e;
  return typeof t.id != "string" || typeof t.imageDataUrl != "string" ? null : {
    id: t.id,
    platform: t.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux",
    imageDataUrl: t.imageDataUrl,
    width: typeof t.width == "number" && Number.isFinite(t.width) ? Math.max(1, Math.round(t.width)) : 1,
    height: typeof t.height == "number" && Number.isFinite(t.height) ? Math.max(1, Math.round(t.height)) : 1,
    hotspotX: typeof t.hotspotX == "number" && Number.isFinite(t.hotspotX) ? Math.max(0, Math.round(t.hotspotX)) : 0,
    hotspotY: typeof t.hotspotY == "number" && Number.isFinite(t.hotspotY) ? Math.max(0, Math.round(t.hotspotY)) : 0,
    scaleFactor: typeof t.scaleFactor == "number" && Number.isFinite(t.scaleFactor) ? Math.max(0.1, t.scaleFactor) : void 0,
    cursorType: typeof t.cursorType == "string" ? t.cursorType : null
  };
}
async function jn(e) {
  const t = `${e}.cursor.json`;
  try {
    const r = await D.readFile(t, "utf-8"), n = JSON.parse(r), a = Array.isArray(n) ? n : Array.isArray(n?.samples) ? n.samples : [], i = Array.isArray(n?.assets) ? n.assets : [], p = a.map((m) => Rs(m)).filter(
      (m) => !!m
    ).sort((m, w) => m.timeMs - w.timeMs), h = i.map((m) => Ns(m)).filter((m) => !!m);
    return {
      version: typeof n?.version == "number" && Number.isFinite(n.version) ? n.version : 1,
      provider: n?.provider === "native" ? "native" : "none",
      samples: p,
      assets: h
    };
  } catch (r) {
    if (r.code === "ENOENT")
      return {
        version: _s,
        provider: "none",
        samples: [],
        assets: []
      };
    throw console.error("Failed to load cursor telemetry:", r), r;
  }
}
async function Yr(e) {
  try {
    return {
      success: !0,
      samples: (await jn(e)).samples.map((r) => ({
        timeMs: r.timeMs,
        cx: r.cx,
        cy: r.cy
      }))
    };
  } catch (t) {
    return console.error("Failed to load cursor telemetry:", t), {
      success: !1,
      message: "Failed to load cursor telemetry",
      error: String(t),
      samples: []
    };
  }
}
function Jr() {
  try {
    if (V.isPackaged) {
      const t = b.join(process.resourcesPath, "assets");
      return Ge(`${t}${b.sep}`).toString();
    }
    const e = b.join(V.getAppPath(), "public", "assets");
    return Ge(`${e}${b.sep}`).toString();
  } catch (e) {
    return console.error("Failed to resolve asset base path:", e), null;
  }
}
function hr() {
  const e = K.getCursorScreenPoint(), t = Number(Z?.display_id);
  return ((Number.isFinite(t) ? K.getAllDisplays().find((n) => n.id === t) ?? null : null) ?? K.getDisplayNearestPoint(e)).bounds;
}
function Vs() {
  return typeof Z?.id == "string" ? Z.id : null;
}
function Xr() {
  const e = Number(Z?.display_id);
  return Number.isFinite(e) ? K.getAllDisplays().find((t) => t.id === e) ?? null : null;
}
function gt(...e) {
  const t = b.join(V.getAppPath(), ...e);
  return V.isPackaged ? t.replace(/\.asar([/\\])/, ".asar.unpacked$1") : t;
}
function In(...e) {
  return V.isPackaged ? b.join(process.resourcesPath, ...e) : null;
}
function Bs() {
  const e = process.env.OPENSCREEN_WGC_CAPTURE_EXE?.trim(), t = process.arch === "arm64" ? "win32-arm64" : "win32-x64";
  return [
    e,
    gt(
      "electron",
      "native",
      "wgc-capture",
      "build",
      "Release",
      "wgc-capture.exe"
    ),
    gt("electron", "native", "wgc-capture", "build", "wgc-capture.exe"),
    gt("electron", "native", "bin", t, "wgc-capture.exe"),
    In("electron", "native", "bin", t, "wgc-capture.exe")
  ].filter((r) => !!r);
}
async function qr() {
  if (process.platform !== "win32")
    return null;
  for (const e of Bs())
    try {
      return await D.access(e, wt.X_OK), e;
    } catch {
    }
  return null;
}
function zs() {
  const e = process.env.OPENSCREEN_SCK_CAPTURE_EXE?.trim(), t = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64", r = "openscreen-screencapturekit-helper";
  return [
    e,
    gt("electron", "native", "screencapturekit", "build", r),
    gt("electron", "native", "bin", t, r),
    In("electron", "native", "bin", t, r)
  ].filter((n) => !!n);
}
async function Qt() {
  if (process.platform !== "darwin")
    return null;
  for (const e of zs())
    try {
      return await D.access(e, wt.X_OK), e;
    } catch {
    }
  return null;
}
function er() {
  if (process.platform !== "darwin")
    return !1;
  const [e] = process.getSystemVersion().split(".").map(Number);
  return Number.isFinite(e) && e >= 15;
}
function Zr() {
  if (process.platform !== "win32")
    return !1;
  const [, , e] = process.getSystemVersion().split(".").map(Number);
  return Number.isFinite(e) && e >= 19041;
}
function tr(e) {
  return e.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function Us(e, t, r) {
  const n = tr(e), a = tr(t), i = tr(r ?? "");
  return i ? n === i ? 1e3 : n.includes(i) || i.includes(n) ? 900 : a.includes(i) || i.includes(a) ? 800 : i.split(/\s+/).filter((p) => p.length > 1 && !["camera", "webcam", "video", "input"].includes(p)).reduce((p, h) => n.includes(h) ? p + 100 : a.includes(h) ? p + 50 : p, 0) : 0;
}
function Ws() {
  return new Promise((e) => {
    const t = Ve(
      "reg.exe",
      ["query", "HKCR\\CLSID\\{860BB310-5D01-11D0-BD3B-00A0C911CE86}\\Instance", "/s"],
      { windowsHide: !0 }
    );
    let r = "";
    t.stdout.on("data", (n) => {
      r += n.toString("utf16le").includes("\0") ? n.toString("utf16le") : n.toString();
    }), t.on("close", () => e(r)), t.on("error", () => e(""));
  });
}
async function Ls(e) {
  if (process.platform !== "win32" || !e?.trim())
    return null;
  const t = await Ws();
  let r = {};
  const n = [];
  for (const i of t.split(/\r?\n/)) {
    const p = i.trim();
    if (!p) continue;
    if (/^HKEY_/i.test(p)) {
      (r.friendlyName || r.clsid) && n.push(r), r = {};
      continue;
    }
    const h = p.match(/^(\S+)\s+REG_SZ\s+(.+)$/);
    h && (h[1] === "FriendlyName" && (r.friendlyName = h[2].trim()), h[1] === "CLSID" && (r.clsid = h[2].trim()));
  }
  (r.friendlyName || r.clsid) && n.push(r);
  let a = null;
  for (const i of n) {
    if (!i.clsid) continue;
    const p = Us(i.friendlyName ?? "", i.clsid, e);
    (!a || p > a.score) && (a = { clsid: i.clsid, friendlyName: i.friendlyName, score: p });
  }
  return !a || a.score <= 0 ? null : (console.info("[native-wgc] resolved DirectShow webcam filter", {
    requestedName: e,
    filterName: a.friendlyName,
    clsid: a.clsid,
    score: a.score
  }), a.clsid);
}
async function rr(e) {
  de && ($ = await de.stop(), de = null), $ = null, de = ts({
    getDisplayBounds: hr,
    maxSamples: Ms,
    platform: process.platform,
    sampleIntervalMs: Es,
    sourceId: Vs(),
    startTimeMs: typeof e == "number" && Number.isFinite(e) ? e : void 0
  });
  try {
    await de.start();
  } catch (t) {
    console.error("Failed to start cursor recording session:", t), de = null;
  }
}
async function je() {
  if (de)
    try {
      $ = await de.stop();
    } catch (e) {
      console.error("Failed to stop cursor recording session:", e), $ = null;
    } finally {
      de = null;
    }
}
async function nr(e) {
  const t = `${e}.cursor.json`;
  $ && $.samples.length > 0 && await D.writeFile(t, JSON.stringify($, null, 2), "utf-8"), $ = null;
}
function Qr(e) {
  !$ || !Number.isFinite(e) || e <= 0 || ($ = {
    ...$,
    samples: $.samples.map((t) => ({
      ...t,
      timeMs: Math.max(0, t.timeMs - e)
    })).sort((t, r) => t.timeMs - r.timeMs)
  });
}
function en(e) {
  if (!$ || e.length === 0)
    return;
  const t = e.map((r) => ({
    startMs: Math.max(0, Math.min(r.startMs, r.endMs)),
    endMs: Math.max(0, Math.max(r.startMs, r.endMs))
  })).filter((r) => Number.isFinite(r.startMs) && Number.isFinite(r.endMs)).filter((r) => r.endMs > r.startMs).sort((r, n) => r.startMs - n.startMs);
  t.length !== 0 && ($ = {
    ...$,
    samples: $.samples.map((r) => {
      let n = 0;
      for (const a of t) {
        if (r.timeMs >= a.startMs && r.timeMs <= a.endMs)
          return null;
        r.timeMs > a.endMs && (n += a.endMs - a.startMs);
      }
      return {
        ...r,
        timeMs: Math.max(0, r.timeMs - n)
      };
    }).filter((r) => !!r).sort((r, n) => r.timeMs - n.timeMs)
  });
}
function tn(e = Date.now()) {
  Re === null || ke <= 0 || (mt.push({
    startMs: Math.max(0, Re - ke),
    endMs: Math.max(0, e - ke)
  }), Re = null);
}
function rn(e = Date.now()) {
  Me === null || Ee <= 0 || (pt.push({
    startMs: Math.max(0, Me - Ee),
    endMs: Math.max(0, e - Ee)
  }), Me = null);
}
function $s(e) {
  return new Promise((t, r) => {
    const n = setTimeout(() => {
      h(), r(new Error("Timed out waiting for native Windows capture to start"));
    }, 12e3), a = (m) => {
      me += m.toString(), me.includes("Recording started") && (h(), t());
    }, i = (m) => {
      h(), r(m);
    }, p = (m) => {
      h(), r(
        new Error(
          me.trim() || `Native Windows capture exited before recording started (code=${m ?? "unknown"})`
        )
      );
    }, h = () => {
      clearTimeout(n), e.stdout.off("data", a), e.stderr.off("data", a), e.off("error", i), e.off("exit", p);
    };
    e.stdout.on("data", a), e.stderr.on("data", a), e.once("error", i), e.once("exit", p);
  });
}
function Gs(e) {
  return new Promise((t, r) => {
    const n = setTimeout(() => {
      h(), e.killed || e.kill(), r(
        new Error(
          `Timed out waiting for native Windows capture to stop. Output path: ${_e ?? "unknown"}. Output: ${me.trim()}`
        )
      );
    }, ks), a = (m) => {
      me += m.toString();
    }, i = (m) => {
      h();
      const w = me.match(/Recording stopped\. Output path: (.+)/);
      if (w?.[1]) {
        t(w[1].trim());
        return;
      }
      if (m === 0 && _e) {
        t(_e);
        return;
      }
      r(
        new Error(
          me.trim() || `Native Windows capture exited with code=${m ?? "unknown"}`
        )
      );
    }, p = (m) => {
      h(), r(m);
    }, h = () => {
      clearTimeout(n), e.stdout.off("data", a), e.stderr.off("data", a), e.off("close", i), e.off("error", p);
    };
    e.stdout.on("data", a), e.stderr.on("data", a), e.once("close", i), e.once("error", p);
  });
}
function Hs(e) {
  const r = e.split(/\r?\n/).filter((n) => n.includes('"event":"webcam-format"')).at(-1);
  if (!r)
    return null;
  try {
    return JSON.parse(r);
  } catch {
    return null;
  }
}
function _n(e) {
  try {
    const t = JSON.parse(e);
    return t && typeof t == "object" ? t : null;
  } catch {
    return null;
  }
}
function En() {
  for (const e of He.split(/\r?\n/)) {
    const t = _n(e.trim());
    t && xe.emit("helper-event", t);
  }
}
function Ks(e) {
  let t = "";
  const r = (a) => {
    const i = a.toString();
    He += i, t += i;
    const p = t.split(/\r?\n/);
    t = p.pop() ?? "";
    for (const h of p) {
      const m = _n(h.trim());
      m && (m.event === "recording-diagnostics" && console.info("[native-sck] recording diagnostics", m), xe.emit("helper-event", m));
    }
  }, n = () => {
    e.stdout.off("data", r), e.stderr.off("data", r), e.off("close", n), e.off("error", n);
  };
  e.stdout.on("data", r), e.stderr.on("data", r), e.once("close", n), e.once("error", n);
}
function Ys(e) {
  return new Promise((t, r) => {
    const n = setTimeout(() => {
      m(), r(new Error("Timed out waiting for native macOS capture to start"));
    }, 1e4), a = (w) => {
      if (w.event === "recording-started") {
        m(), t(w);
        return;
      }
      w.event === "error" && (m(), r(new Error(String(w.message ?? w.code ?? "Native macOS capture failed"))));
    }, i = (w) => a(w), p = (w) => {
      m(), r(
        new Error(
          He.trim() || `Native macOS capture exited before recording started (code=${w ?? "unknown"})`
        )
      );
    }, h = (w) => {
      m(), r(w);
    }, m = () => {
      clearTimeout(n), xe.off("helper-event", i), e.off("close", p), e.off("error", h);
    };
    xe.on("helper-event", i), e.once("close", p), e.once("error", h), En();
  });
}
function nn(e, t, r = 3e4) {
  return new Promise((n, a) => {
    const i = setTimeout(() => {
      w(), a(new Error(`Timed out waiting for native macOS ${t}`));
    }, r), p = (C) => {
      if (C.event === t) {
        w(), n(C);
        return;
      }
      C.event === "error" && (w(), a(new Error(String(C.message ?? C.code ?? "Native macOS capture failed"))));
    }, h = (C) => {
      w(), a(new Error(`Native macOS capture exited during ${t} (code=${C})`));
    }, m = (C) => {
      w(), a(C);
    }, w = () => {
      clearTimeout(i), xe.off("helper-event", p), e.off("close", h), e.off("error", m);
    };
    xe.on("helper-event", p), e.once("close", h), e.once("error", m);
  });
}
function Js(e) {
  return new Promise((t, r) => {
    const n = setTimeout(() => {
      m(), r(
        new Error(
          `Timed out waiting for native macOS capture to stop. Output path: ${Se ?? "unknown"}. Output: ${He.trim()}`
        )
      );
    }, 12e4), a = (w) => {
      if (w.event === "recording-stopped") {
        m(), t({
          screenPath: String(w.screenPath ?? Se ?? ""),
          audioTracks: mn(w.audioTracks),
          timestampMs: typeof w.timestampMs == "number" && Number.isFinite(w.timestampMs) ? w.timestampMs : void 0
        });
        return;
      }
      w.event === "error" && (m(), r(new Error(String(w.message ?? w.code ?? "Native macOS capture failed"))));
    }, i = (w) => a(w), p = (w) => {
      if (w === 0 && Se) {
        m(), t({ screenPath: Se });
        return;
      }
      m(), r(
        new Error(
          He.trim() || `Native macOS capture exited with code=${w ?? "unknown"}`
        )
      );
    }, h = (w) => {
      m(), r(w);
    }, m = () => {
      clearTimeout(n), xe.off("helper-event", i), e.off("close", p), e.off("error", h);
    };
    xe.on("helper-event", i), e.once("close", p), e.once("error", h), En();
  });
}
function oe(e) {
  le = e, ge = e?.screenVideoPath ?? null;
}
function Xs(e) {
  const t = b.parse(e), r = t.name.endsWith("-webcam") ? t.name.slice(0, -7) : t.name;
  return b.join(t.dir, `${r}${$e}`);
}
async function on(e) {
  try {
    const t = Xs(e);
    if (!Te(t)) {
      const h = b.parse(e);
      if (!Wt(b.resolve(t), h.dir))
        return null;
    }
    const r = await D.readFile(t, "utf-8"), n = hn(JSON.parse(r));
    if (!n)
      return null;
    const a = yt(e), i = yt(n.screenVideoPath) === a, p = typeof n.webcamVideoPath == "string" && yt(n.webcamVideoPath) === a;
    if (!i && !p)
      return null;
    if (!Te(n.screenVideoPath)) {
      const h = await pe(n.screenVideoPath, [
        b.dirname(t),
        U
      ]);
      if (!h)
        return null;
      n.screenVideoPath = h;
    }
    if (n.webcamVideoPath && !Te(n.webcamVideoPath)) {
      const h = await pe(n.webcamVideoPath, [
        b.dirname(t),
        U
      ]);
      h ? n.webcamVideoPath = h : n.webcamVideoPath = void 0;
    }
    return Bt(n.screenVideoPath), n.webcamVideoPath && Bt(n.webcamVideoPath), n;
  } catch (t) {
    return t.code !== "ENOENT" && console.error("Failed to restore recording session manifest:", t), null;
  }
}
function qs(e, t, r, n, a, i, p, h) {
  async function m() {
    if (process.platform !== "darwin")
      return { success: !0, granted: !0, status: "granted" };
    try {
      const l = ue.getMediaAccessStatus("screen");
      if (l === "granted")
        return { success: !0, granted: !0, status: l };
      if (l === "not-determined") {
        const o = n();
        return o && !o.isDestroyed() && (o.isVisible() || o.show(), o.focus()), V.focus({ steal: !0 }), bt.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } }).catch(() => {
        }), { success: !0, granted: !1, status: "not-determined" };
      }
      return { success: !0, granted: !1, status: l };
    } catch (l) {
      return console.error("Failed to request screen access:", l), { success: !1, granted: !1, status: "unknown", error: String(l) };
    }
  }
  F.handle("get-sources", async (l, o) => {
    const s = await bt.getSources(o);
    return Ot = new Map(s.map((c) => [c.id, c])), s.map((c) => ({
      id: c.id,
      name: c.name,
      display_id: c.display_id,
      thumbnail: c.thumbnail ? c.thumbnail.toDataURL() : null,
      appIcon: c.appIcon ? c.appIcon.toDataURL() : null
    }));
  }), F.handle("list-native-windows", async () => {
    try {
      if (process.platform !== "darwin" || !er())
        return { success: !0, windows: [] };
      const l = await Qt();
      if (!l) return { success: !0, windows: [] };
      const o = await D.mkdtemp(b.join(Tt.tmpdir(), "openscreen-native-windows-"));
      try {
        const s = Date.now(), c = await ht(l, ["list-windows", o], {
          timeoutMs: 2e4
        });
        if (c.code !== 0) {
          const v = c.timedOut ? "Timed out enumerating windows" : c.stderr || c.stdout || "Failed to enumerate windows";
          return console.warn(`list-native-windows helper failed (code ${c.code}): ${v}`), { success: !1, message: v };
        }
        let S = [];
        for (const v of c.stdout.split(`
`))
          if (v.trim())
            try {
              const g = JSON.parse(v);
              g?.event === "windows" && Array.isArray(g.windows) && (S = g.windows);
            } catch {
            }
        return console.log(
          `list-native-windows: ${S.length} windows in ${Date.now() - s}ms`
        ), { success: !0, windows: await Promise.all(
          S.filter((v) => typeof v.windowId == "number").map(async (v) => {
            let g = null;
            if (typeof v.thumbnailPath == "string")
              try {
                g = `data:image/png;base64,${(await D.readFile(v.thumbnailPath)).toString("base64")}`;
              } catch {
              }
            const A = String(v.title ?? ""), j = String(v.appName ?? "");
            return {
              // Same id shape Electron's desktopCapturer uses, so the native
              // recording path parses the windowId without special-casing.
              id: `window:${v.windowId}:0`,
              windowId: Number(v.windowId),
              name: [j, A].filter(Boolean).join(" — ") || A || j,
              appName: j,
              title: A,
              isOnScreen: !!v.isOnScreen,
              thumbnail: g
            };
          })
        ) };
      } finally {
        await D.rm(o, { recursive: !0, force: !0 }).catch(() => {
        });
      }
    } catch (l) {
      return { success: !1, message: l instanceof Error ? l.message : String(l) };
    }
  }), F.handle("select-source", async (l, o) => {
    if (Z = o, dt = typeof o.id == "string" ? Ot.get(o.id) ?? null : null, !dt && typeof o.id == "string")
      try {
        const c = await bt.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: !0
        });
        Ot = new Map(c.map((S) => [S.id, S])), dt = Ot.get(o.id) ?? null;
      } catch {
        dt = null;
      }
    const s = a();
    return s && s.close(), Z;
  }), F.handle("get-selected-source", () => Z), F.handle("request-camera-access", async () => {
    if (process.platform !== "darwin")
      return { success: !0, granted: !0, status: "granted" };
    try {
      const l = ue.getMediaAccessStatus("camera");
      if (l === "granted")
        return { success: !0, granted: !0, status: l };
      if (l === "not-determined") {
        const o = await ue.askForMediaAccess("camera");
        return {
          success: !0,
          granted: o,
          status: o ? "granted" : ue.getMediaAccessStatus("camera")
        };
      }
      return { success: !0, granted: !1, status: l };
    } catch (l) {
      return console.error("Failed to request camera access:", l), {
        success: !1,
        granted: !1,
        status: "unknown",
        error: String(l)
      };
    }
  }), F.handle("request-screen-access", async () => m()), F.handle("request-native-mac-cursor-access", async () => await Ka()), F.handle("open-source-selector", async () => {
    const l = await m();
    if (!l.granted) {
      if (process.platform === "darwin" && l.status !== "not-determined") {
        const s = n(), c = {
          type: "warning",
          buttons: ["Open System Settings", "Cancel"],
          defaultId: 0,
          cancelId: 1,
          message: "Screen Recording permission is required",
          detail: "Allow OpenScreen in macOS System Settings, then come back and choose a screen or window."
        };
        (s && !s.isDestroyed() ? await De.showMessageBox(s, c) : await De.showMessageBox(c)).response === 0 && await Pt.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        );
      }
      return {
        opened: !1,
        reason: "screen-access-required",
        access: l
      };
    }
    const o = a();
    return o ? (o.focus(), { opened: !0 }) : (t(), { opened: !0 });
  }), F.handle("switch-to-editor", () => {
    e();
  }), F.handle("switch-to-hud", () => (h?.(), { success: !0 })), F.handle("start-new-recording", () => (h?.(), { success: !0 })), F.handle("countdown-overlay-show", async (l, o, s) => {
    const c = i?.() ?? r();
    c.isDestroyed() || (c.webContents.isLoading() && await new Promise((S) => {
      c.once("ready-to-show", S);
    }), c.isVisible() || c.showInactive(), c.webContents.send("countdown-overlay-value", o, s));
  }), F.handle("countdown-overlay-set-value", (l, o, s) => {
    const c = i?.();
    !c || c.isDestroyed() || c.webContents.send("countdown-overlay-value", o, s);
  }), F.handle("countdown-overlay-hide", (l, o) => {
    const s = i?.();
    !s || s.isDestroyed() || (s.webContents.send("countdown-overlay-value", null, o), s.hide());
  }), F.handle("is-native-windows-capture-available", async () => {
    if (!Zr())
      return { success: !0, available: !1, reason: "unsupported-os" };
    const l = await qr();
    return l ? { success: !0, available: !0, helperPath: l } : { success: !0, available: !1, reason: "missing-helper" };
  }), F.handle("is-native-mac-capture-available", async () => {
    if (!er())
      return { success: !0, available: !1, reason: "unsupported-platform" };
    const l = await Qt();
    return l ? { success: !0, available: !0, helperPath: l } : { success: !0, available: !1, reason: "missing-helper" };
  }), F.handle(
    "start-native-windows-recording",
    async (l, o) => {
      try {
        if (!Zr())
          return {
            success: !1,
            error: "Windows Graphics Capture requires Windows 10 build 19041 or newer."
          };
        if (he)
          return { success: !1, error: "Native Windows capture is already running." };
        const s = await qr();
        if (!s)
          return { success: !1, error: "Native Windows capture helper is not available." };
        if (!o?.source?.sourceId)
          return {
            success: !1,
            error: "Native Windows capture request is missing a source."
          };
        const c = typeof o.recordingId == "number" && Number.isFinite(o.recordingId) ? o.recordingId : Date.now(), S = b.join(U, `${Ct}${c}.mp4`), x = b.join(
          U,
          `${Ct}${c}-webcam.mp4`
        ), v = o.source.type === "display" && typeof o.source.displayId == "number" ? K.getAllDisplays().find((ze) => ze.id === o.source.displayId) ?? null : Xr(), g = v?.bounds ?? hr(), A = typeof o.source.displayId == "number" && Number.isFinite(o.source.displayId) ? o.source.displayId : Number(Z?.display_id), j = o.webcam.enabled ? await Ls(o.webcam.deviceName) : null, _ = Le(o.cursor?.mode) ?? "editable-overlay", N = {
          schemaVersion: 2,
          recordingId: c,
          outputPath: S,
          sourceType: o.source.type,
          sourceId: o.source.sourceId,
          displayId: Number.isFinite(A) ? A : 0,
          windowHandle: o.source.windowHandle ?? null,
          fps: o.video.fps,
          videoWidth: o.video.width,
          videoHeight: o.video.height,
          displayX: g.x,
          displayY: g.y,
          displayW: g.width,
          displayH: g.height,
          hasDisplayBounds: !0,
          captureSystemAudio: o.audio.system.enabled,
          captureMic: o.audio.microphone.enabled,
          microphoneDeviceId: o.audio.microphone.deviceId ?? null,
          microphoneDeviceName: o.audio.microphone.deviceName ?? null,
          microphoneGain: o.audio.microphone.gain,
          webcamEnabled: o.webcam.enabled,
          webcamDeviceId: o.webcam.deviceId ?? null,
          webcamDeviceName: o.webcam.deviceName ?? null,
          webcamDirectShowClsid: j,
          webcamWidth: o.webcam.width,
          webcamHeight: o.webcam.height,
          webcamFps: o.webcam.fps,
          captureCursor: _ === "system",
          cursorCaptureMode: _,
          outputs: {
            screenPath: S,
            webcamPath: x
          },
          source: {
            type: o.source.type,
            sourceId: o.source.sourceId,
            displayId: Number.isFinite(A) ? A : null,
            windowHandle: o.source.windowHandle ?? null,
            bounds: g
          },
          video: o.video,
          audio: o.audio,
          webcam: o.webcam,
          cursor: {
            mode: _
          }
        };
        console.info("[native-wgc] starting Windows capture", {
          helperPath: s,
          source: o.source,
          audio: o.audio,
          webcam: o.webcam,
          cursor: { mode: _ },
          bounds: g,
          sourceId: Z?.id ?? null,
          usedDisplayMatch: !!v,
          outputPath: S
        }), await D.mkdir(U, { recursive: !0 }), me = "", _e = S, jt = o.webcam.enabled ? x : null, It = c, We = 0, _t = _, Ee = 0, Me = null, pt = [], Ae = !1;
        const R = Date.now();
        _ === "editable-overlay" ? (Ee = R, await rr(R), console.info("[native-wgc] cursor sampler ready", {
          cursorStartTimeMs: R,
          warmupMs: Date.now() - R
        })) : $ = null;
        const E = Ve(s, [JSON.stringify(N)], {
          cwd: U,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: !0
        });
        he = E, await $s(E);
        const re = Date.now();
        We = _ === "editable-overlay" ? Math.max(0, re - R) : 0;
        const Be = Hs(me);
        return console.info("[native-wgc] capture started", {
          captureStartedAtMs: re,
          cursorOffsetMs: We,
          webcamFormat: Be
        }), p && p(!0, (Z || { name: "Screen" }).name), {
          success: !0,
          recordingId: c,
          path: S,
          helperPath: s,
          captureStartedAtMs: re
        };
      } catch (s) {
        return console.error("Failed to start native Windows recording:", s), he?.kill(), he = null, _e = null, jt = null, It = null, We = 0, _t = "editable-overlay", Ee = 0, Me = null, pt = [], Ae = !1, await je(), { success: !1, error: String(s) };
      }
    }
  ), F.handle("start-native-mac-recording", async (l, o) => {
    try {
      if (!er())
        return { success: !1, error: "Native macOS capture requires macOS 15 or newer." };
      if (ye)
        return { success: !1, error: "Native macOS capture is already running." };
      const s = await Qt();
      if (!s)
        return { success: !1, error: "Native macOS capture helper is not available." };
      if (!o?.source?.sourceId)
        return { success: !1, error: "Native macOS capture request is missing a source." };
      const c = typeof o.recordingId == "number" && Number.isFinite(o.recordingId) ? o.recordingId : Date.now(), S = b.join(U, `${Ct}${c}.mp4`), x = Le(o.cursor?.mode) ?? "editable-overlay";
      try {
        await bt.getSources({
          types: ["screen"],
          thumbnailSize: { width: 1, height: 1 }
        });
      } catch {
      }
      o.audio?.microphone?.enabled && ue.getMediaAccessStatus("microphone") !== "granted" && await ue.askForMediaAccess("microphone");
      const v = o.source.type === "display" && typeof o.source.displayId == "number" ? K.getAllDisplays().find((re) => re.id === o.source.displayId) ?? null : Xr(), g = o.source.bounds ?? v?.bounds ?? hr(), A = {
        ...o,
        schemaVersion: 1,
        recordingId: c,
        source: {
          ...o.source,
          bounds: g
        },
        video: {
          ...o.video,
          hideSystemCursor: x === "editable-overlay"
        },
        webcam: {
          ...o.webcam,
          enabled: !1
        },
        cursor: {
          mode: x
        },
        outputs: {
          screenPath: S,
          manifestPath: b.join(
            U,
            `${Ct}${c}${$e}`
          )
        }
      };
      console.info("[native-sck] starting macOS capture", {
        helperPath: s,
        source: A.source,
        audio: A.audio,
        webcam: A.webcam,
        cursor: A.cursor,
        outputPath: S
      }), await D.mkdir(U, { recursive: !0 }), He = "", Se = S, Et = c, Mt = [
        ...A.audio?.system?.enabled ? ["system"] : [],
        ...A.audio?.microphone?.enabled ? ["microphone"] : []
      ], ut = 0, kt = x, ke = 0, Re = null, mt = [], Oe = !1;
      const j = Date.now();
      x === "editable-overlay" ? (ke = j, await rr(j)) : $ = null;
      const _ = Ve(s, [JSON.stringify(A)], {
        cwd: U,
        stdio: ["pipe", "pipe", "pipe"]
      });
      ye = _, Ks(_);
      const N = await Ys(_), R = typeof N.timestampMs == "number" && Number.isFinite(N.timestampMs) ? N.timestampMs : Date.now();
      return ut = x === "editable-overlay" ? Math.max(0, R - j) : 0, p && p(!0, (Z || { name: "Screen" }).name), {
        success: !0,
        recordingId: c,
        path: S,
        helperPath: s,
        captureStartedAtMs: R
      };
    } catch (s) {
      return console.error("Failed to start native macOS recording:", s), ye?.kill(), ye = null, Se = null, Et = null, Mt = null, ut = 0, kt = "editable-overlay", ke = 0, Re = null, mt = [], Oe = !1, await je(), { success: !1, error: s instanceof Error ? s.message : String(s) };
    }
  }), F.handle("pause-native-mac-recording", async () => {
    if (process.platform !== "darwin")
      return { success: !1, error: "Native macOS capture requires macOS." };
    const l = ye;
    if (!l)
      return { success: !1, error: "Native macOS capture is not running." };
    if (Oe)
      return { success: !0 };
    if (!l.stdin.writable)
      return { success: !1, error: "Native macOS capture command channel is closed." };
    try {
      const o = nn(l, "recording-paused");
      l.stdin.write(`pause
`);
      const s = await o, c = typeof s.timestampMs == "number" && Number.isFinite(s.timestampMs) ? s.timestampMs : Date.now();
      return Oe = !0, Re = c, { success: !0, timestampMs: c };
    } catch (o) {
      return { success: !1, error: o instanceof Error ? o.message : String(o) };
    }
  }), F.handle("resume-native-mac-recording", async () => {
    if (process.platform !== "darwin")
      return { success: !1, error: "Native macOS capture requires macOS." };
    const l = ye;
    if (!l)
      return { success: !1, error: "Native macOS capture is not running." };
    if (!Oe)
      return { success: !0 };
    if (!l.stdin.writable)
      return { success: !1, error: "Native macOS capture command channel is closed." };
    try {
      const o = nn(l, "recording-resumed");
      l.stdin.write(`resume
`);
      const s = await o, c = typeof s.timestampMs == "number" && Number.isFinite(s.timestampMs) ? s.timestampMs : Date.now();
      return tn(), Oe = !1, { success: !0, timestampMs: c };
    } catch (o) {
      return { success: !1, error: o instanceof Error ? o.message : String(o) };
    }
  }), F.handle("pause-native-windows-recording", async () => {
    const l = he;
    if (!l)
      return { success: !1, error: "Native Windows capture is not running." };
    if (Ae)
      return { success: !0 };
    if (!l.stdin.writable)
      return { success: !1, error: "Native Windows capture command channel is closed." };
    try {
      const o = Date.now();
      return l.stdin.write(`pause
`), Ae = !0, Me = o, { success: !0, timestampMs: o };
    } catch (o) {
      return { success: !1, error: o instanceof Error ? o.message : String(o) };
    }
  }), F.handle("resume-native-windows-recording", async () => {
    const l = he;
    if (!l)
      return { success: !1, error: "Native Windows capture is not running." };
    if (!Ae)
      return { success: !0 };
    if (!l.stdin.writable)
      return { success: !1, error: "Native Windows capture command channel is closed." };
    try {
      const o = Date.now();
      return l.stdin.write(`resume
`), rn(), Ae = !1, { success: !0, timestampMs: o };
    } catch (o) {
      return { success: !1, error: o instanceof Error ? o.message : String(o) };
    }
  }), F.handle("stop-native-windows-recording", async (l, o) => {
    const s = he, c = _e, S = jt, x = It ?? Date.now(), v = _t;
    if (!s)
      return { success: !1, error: "Native Windows capture is not running." };
    try {
      rn();
      const g = Gs(s), A = Date.now();
      s.stdin.write(`stop
`);
      const _ = await g || c;
      if (!_)
        throw new Error("Native Windows capture did not return an output path.");
      if (v === "editable-overlay" ? await je() : $ = null, o)
        return $ = null, await Promise.all([
          D.rm(_, { force: !0 }),
          S ? D.rm(S, { force: !0 }) : Promise.resolve(),
          D.rm(`${_}.cursor.json`, { force: !0 })
        ]), { success: !0, discarded: !0 };
      v === "editable-overlay" && (en(pt), Qr(We), await nr(_));
      let N;
      if (S)
        try {
          await D.access(S, wt.R_OK), N = S;
        } catch {
          N = void 0;
        }
      const R = N ? { screenVideoPath: _, webcamVideoPath: N, createdAt: x, cursorCaptureMode: v } : { screenVideoPath: _, createdAt: x, cursorCaptureMode: v };
      oe(R), Y = null;
      const E = b.join(
        U,
        `${b.parse(_).name}${$e}`
      );
      return await D.writeFile(E, JSON.stringify(R, null, 2), "utf-8"), {
        success: !0,
        path: _,
        session: R,
        message: "Native Windows recording session stored successfully",
        timestampMs: A
      };
    } catch (g) {
      return console.error("Failed to stop native Windows recording:", g), await je(), { success: !1, error: String(g) };
    } finally {
      he = null, _e = null, jt = null, It = null, We = 0, _t = "editable-overlay", Ee = 0, Me = null, pt = [], Ae = !1, p && p(!1, (Z || { name: "Screen" }).name);
    }
  }), F.handle("stop-native-mac-recording", async (l, o) => {
    if (process.platform !== "darwin")
      return { success: !1, error: "Native macOS capture requires macOS." };
    const s = ye, c = Se, S = Et ?? Date.now(), x = kt, v = Mt;
    if (!s)
      return { success: !1, error: "Native macOS capture is not running." };
    try {
      tn();
      const g = Js(s);
      s.stdin.write(`stop
`);
      const A = await g, j = A.screenPath || c;
      if (!j)
        throw new Error("Native macOS capture did not return an output path.");
      if (x === "editable-overlay" ? await je() : $ = null, o)
        return $ = null, await Promise.all([
          D.rm(j, { force: !0 }),
          D.rm(`${j}.cursor.json`, { force: !0 }),
          D.rm(`${j}.diagnostics.json`, { force: !0 })
        ]), { success: !0, discarded: !0 };
      x === "editable-overlay" && (en(mt), Qr(ut), await nr(j));
      const _ = v?.length ? v.length === 2 ? [{ ordinal: 0, role: "mixed" }] : [{ ordinal: 0, role: v[0] }] : [], N = A.audioTracks ?? _, R = {
        screenVideoPath: j,
        createdAt: S,
        cursorCaptureMode: x,
        ...N.length ? { audioTracks: N } : {}
      };
      oe(R), Y = null;
      const E = b.join(
        U,
        `${b.parse(j).name}${$e}`
      );
      return await D.writeFile(E, JSON.stringify(R, null, 2), "utf-8"), {
        success: !0,
        path: j,
        session: R,
        message: "Native macOS recording session stored successfully",
        timestampMs: A.timestampMs
      };
    } catch (g) {
      return console.error("Failed to stop native macOS recording:", g), await je(), { success: !1, error: g instanceof Error ? g.message : String(g) };
    } finally {
      ye = null, Se = null, Et = null, Mt = null, ut = 0, kt = "editable-overlay", ke = 0, Re = null, mt = [], Oe = !1, p && p(!1, (Z || { name: "Screen" }).name);
    }
  }), F.handle(
    "attach-native-mac-webcam-recording",
    async (l, o) => {
      try {
        if (process.platform !== "darwin")
          return { success: !1, error: "Native macOS webcam attachment requires macOS." };
        const s = ve(o.screenVideoPath);
        if (!s || !Wt(s, U))
          return {
            success: !1,
            error: "Native macOS webcam attachment requires a recording output path."
          };
        if (await D.access(s, wt.R_OK), !o.webcam?.fileName || !o.webcam.videoData)
          return { success: !1, error: "Native macOS webcam attachment is missing video data." };
        const c = Dt(o.webcam.fileName);
        await D.writeFile(c, Buffer.from(o.webcam.videoData));
        const S = typeof o.recordingId == "number" && Number.isFinite(o.recordingId) ? o.recordingId : Date.now(), x = Le(o.cursorCaptureMode), v = le?.screenVideoPath === s ? le : await on(s), g = v?.audioTracks, A = lr(o.webcamSync) ?? v?.webcamSync, j = {
          screenVideoPath: s,
          webcamVideoPath: c,
          createdAt: S,
          ...x ? { cursorCaptureMode: x } : {},
          ...g?.length ? { audioTracks: g } : {},
          ...A ? { webcamSync: A } : {}
        };
        oe(j), Y = null;
        const _ = b.join(
          U,
          `${b.parse(s).name}${$e}`
        );
        return await D.writeFile(_, JSON.stringify(j, null, 2), "utf-8"), {
          success: !0,
          path: s,
          session: j,
          message: "Native macOS webcam recording attached successfully"
        };
      } catch (s) {
        return console.error("Failed to attach native macOS webcam recording:", s), {
          success: !1,
          error: s instanceof Error ? s.message : String(s)
        };
      }
    }
  );
  const w = new vs();
  Ss(F, w, Dt), F.handle("store-recorded-session", async (l, o) => {
    try {
      return await C(o);
    } catch (s) {
      return console.error("Failed to store recording session:", s), {
        success: !1,
        message: "Failed to store recording session",
        error: String(s)
      };
    }
  });
  async function C(l) {
    const o = typeof l.createdAt == "number" && Number.isFinite(l.createdAt) ? l.createdAt : Date.now(), s = Le(l.cursorCaptureMode), c = Dt(l.screen.fileName), S = await Kr(
      w,
      l.screen.fileName,
      c,
      l.screen.videoData
    );
    let x, v = !1;
    l.webcam && (x = Dt(l.webcam.fileName), v = await Kr(
      w,
      l.webcam.fileName,
      x,
      l.webcam.videoData
    ));
    const g = l.screen.durationMs ?? l.durationMs, A = l.webcam?.durationMs ?? l.durationMs;
    if (At(g) || At(A)) {
      const R = [];
      S && At(g) && R.push(Gr(c, g)), v && x && At(A) && R.push(Gr(x, A)), await Promise.all(R);
    }
    const j = x ? lr(l.webcamSync) : void 0, _ = x ? {
      screenVideoPath: c,
      webcamVideoPath: x,
      createdAt: o,
      ...s ? { cursorCaptureMode: s } : {},
      ...j ? { webcamSync: j } : {}
    } : { screenVideoPath: c, createdAt: o, ...s ? { cursorCaptureMode: s } : {} };
    oe(_), Y = null, await nr(c);
    const N = b.join(
      U,
      `${b.parse(l.screen.fileName).name}${$e}`
    );
    return await D.writeFile(N, JSON.stringify(_, null, 2), "utf-8"), {
      success: !0,
      path: c,
      session: _,
      message: "Recording session stored successfully"
    };
  }
  F.handle("store-recorded-video", async (l, o, s) => {
    try {
      return await C({
        screen: { videoData: o, fileName: s },
        createdAt: Date.now()
      });
    } catch (c) {
      return console.error("Failed to store recorded video:", c), {
        success: !1,
        message: "Failed to store recorded video",
        error: String(c)
      };
    }
  }), F.handle("get-recorded-video-path", async () => {
    try {
      if (le?.screenVideoPath)
        return { success: !0, path: le.screenVideoPath };
      const o = (await D.readdir(U)).filter(
        (S) => S.endsWith(".webm") && !S.endsWith("-webcam.webm")
      );
      if (o.length === 0)
        return { success: !1, message: "No recorded video found" };
      const s = o.sort().reverse()[0];
      return { success: !0, path: b.join(U, s) };
    } catch (l) {
      return console.error("Failed to get video path:", l), { success: !1, message: "Failed to get video path", error: String(l) };
    }
  }), F.handle(
    "set-recording-state",
    async (l, o, s, c) => {
      const S = Le(c) ?? "editable-overlay";
      o && S === "editable-overlay" ? await rr(s) : await je(), p && p(o, (Z || { name: "Screen" }).name);
    }
  ), F.handle("get-cursor-telemetry", async (l, o) => {
    const s = As(
      o ?? le?.screenVideoPath
    );
    return s ? Yr(s) : { success: !0, samples: [] };
  }), F.handle("open-external-url", async (l, o) => {
    try {
      return await Pt.openExternal(o), { success: !0 };
    } catch (s) {
      return console.error("Failed to open URL:", s), { success: !1, error: String(s) };
    }
  }), F.handle("get-asset-base-path", () => Jr()), F.handle("pick-export-save-path", async (l, o, s) => {
    try {
      const c = o.toLowerCase().endsWith(".gif"), S = c ? [{ name: I("dialogs", "fileDialogs.gifImage"), extensions: ["gif"] }] : [{ name: I("dialogs", "fileDialogs.mp4Video"), extensions: ["mp4"] }];
      let x = V.getPath("downloads");
      if (s)
        try {
          (await D.stat(s)).isDirectory() && (x = s);
        } catch (A) {
          console.warn(
            `Could not access remembered export folder "${s}", falling back to Downloads:`,
            A
          );
        }
      const v = Ft(
        {
          title: c ? I("dialogs", "fileDialogs.saveGif") : I("dialogs", "fileDialogs.saveVideo"),
          defaultPath: b.join(x, o),
          filters: S,
          properties: ["createDirectory", "showOverwriteConfirmation"]
        },
        n()
      ), g = await De.showSaveDialog(v);
      return g.canceled || !g.filePath ? { success: !1, canceled: !0, message: "Export canceled" } : { success: !0, path: b.normalize(g.filePath) };
    } catch (c) {
      return console.error("Failed to show save dialog:", c), {
        success: !1,
        message: "Failed to show save dialog",
        error: String(c)
      };
    }
  }), F.handle("write-export-to-path", async (l, o, s) => {
    try {
      if (typeof s != "string" || !b.isAbsolute(s))
        return { success: !1, message: "Invalid path" };
      const c = s.toLowerCase();
      if (!c.endsWith(".mp4") && !c.endsWith(".gif"))
        return { success: !1, message: "Invalid file type" };
      const S = b.normalize(s);
      return await D.mkdir(b.dirname(S), { recursive: !0 }), await D.writeFile(S, Buffer.from(o)), {
        success: !0,
        path: S,
        message: "Video exported successfully"
      };
    } catch (c) {
      return console.error("Failed to write exported video:", c), {
        success: !1,
        message: "Failed to save exported video",
        error: String(c)
      };
    }
  }), F.handle("copy-export-source-to-path", async (l, o, s) => {
    try {
      const c = ve(o);
      if (!c || !Te(c) || typeof s != "string" || !b.isAbsolute(s) || !s.toLowerCase().endsWith(".mp4"))
        return { success: !1, message: "Invalid export path" };
      const S = b.normalize(s);
      return await D.mkdir(b.dirname(S), { recursive: !0 }), await D.copyFile(c, S), { success: !0, path: S, message: "Video copied successfully" };
    } catch (c) {
      return {
        success: !1,
        message: c instanceof Error ? c.message : String(c)
      };
    }
  }), F.handle("open-video-file-picker", async () => {
    try {
      const l = Ft(
        {
          title: I("dialogs", "fileDialogs.selectVideo"),
          defaultPath: U,
          filters: [
            {
              name: I("dialogs", "fileDialogs.videoFiles"),
              extensions: ["webm", "mp4", "mov", "avi", "mkv", "m4v", "wmv", "flv", "ts"]
            },
            { name: I("dialogs", "fileDialogs.allFiles"), extensions: ["*"] }
          ],
          properties: ["openFile"]
        },
        n()
      ), o = await De.showOpenDialog(l);
      if (o.canceled || o.filePaths.length === 0)
        return { success: !1, canceled: !0 };
      const s = await pe(o.filePaths[0]);
      return s ? (Y = null, {
        success: !0,
        path: s
      }) : {
        success: !1,
        message: "Selected file is not a supported readable video file"
      };
    } catch (l) {
      return console.error("Failed to open file picker:", l), {
        success: !1,
        message: "Failed to open file picker",
        error: String(l)
      };
    }
  }), F.handle("reveal-in-folder", async (l, o) => {
    try {
      return Pt.showItemInFolder(o), { success: !0 };
    } catch (s) {
      console.error(`Error revealing item in folder: ${o}`, s);
      try {
        const c = await Pt.openPath(b.dirname(o));
        return c ? { success: !1, error: c } : { success: !0, message: "Could not reveal item, but opened directory." };
      } catch (c) {
        return console.error(`Error opening directory: ${b.dirname(o)}`, c), { success: !1, error: String(s) };
      }
    }
  }), F.handle("read-binary-file", async (l, o) => {
    try {
      const s = await pe(o);
      if (!s)
        return {
          success: !1,
          message: "File path is not approved or is not a supported video file"
        };
      const c = await D.readFile(s);
      return {
        success: !0,
        data: c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength),
        path: s
      };
    } catch (s) {
      return console.error("Failed to read binary file:", s), {
        success: !1,
        message: "Failed to read binary file",
        error: String(s)
      };
    }
  }), F.handle("create-media-source-handle", async (l, o) => {
    const s = ve(o);
    if (!s || !Te(s))
      return { success: !1, message: "Source file is not approved" };
    try {
      const c = await D.stat(s), S = cr(), x = await Ts();
      return Vt.set(S, {
        filePath: s,
        expiresAt: Date.now() + 1800 * 1e3
      }), {
        success: !0,
        id: S,
        url: `http://127.0.0.1:${x}/media/${S}`,
        size: c.size,
        mtimeMs: c.mtimeMs
      };
    } catch (c) {
      return { success: !1, message: c instanceof Error ? c.message : String(c) };
    }
  }), F.handle("release-media-source-handle", (l, o) => (Vt.delete(o), { success: !0 })), F.handle(
    "prepare-preview-audio-track",
    async (l, o, s) => {
      try {
        return await Os(o, s);
      } catch (c) {
        return console.error("Failed to prepare preview audio track:", c), {
          success: !1,
          message: "Failed to prepare preview audio track",
          error: String(c)
        };
      }
    }
  ), F.handle("inspect-audio-tracks", async (l, o) => {
    try {
      const s = await pe(o);
      if (!s) return { success: !1, message: "Source file is not approved" };
      if (process.platform !== "darwin" || b.extname(s).toLowerCase() !== ".mp4")
        return {
          success: !1,
          message: "Audio track inspection is only available for macOS MP4"
        };
      const c = await ht("/usr/bin/afinfo", [s]);
      return c.code !== 0 ? { success: !1, message: c.stderr || "Unable to inspect audio tracks" } : {
        success: !0,
        tracks: Dn(`${c.stdout}
${c.stderr}`).map((x, v) => ({ ordinal: v, bitRate: x }))
      };
    } catch (s) {
      return { success: !1, message: s instanceof Error ? s.message : String(s) };
    }
  }), F.handle(
    "save-project-file",
    async (l, o, s, c) => k(o, s, c)
  );
  async function k(l, o, s) {
    try {
      const c = Is(s) ? s : null;
      if (c)
        return await D.writeFile(
          c,
          JSON.stringify(l, null, 2),
          "utf-8"
        ), Y = c, {
          success: !0,
          path: c,
          message: "Project saved successfully"
        };
      const S = (o || `project-${Date.now()}`).replace(/[^a-zA-Z0-9-_]/g, "_"), x = S.endsWith(`.${it}`) ? S : `${S}.${it}`, v = Ft(
        {
          title: I("dialogs", "fileDialogs.saveProject"),
          defaultPath: b.join(U, x),
          filters: [
            {
              name: I("dialogs", "fileDialogs.openscreenProject"),
              extensions: [it]
            },
            { name: "JSON", extensions: ["json"] }
          ],
          properties: ["createDirectory", "showOverwriteConfirmation"]
        },
        n()
      ), g = await De.showSaveDialog(v);
      return g.canceled || !g.filePath ? {
        success: !1,
        canceled: !0,
        message: "Save project canceled"
      } : (await D.writeFile(g.filePath, JSON.stringify(l, null, 2), "utf-8"), Y = g.filePath, {
        success: !0,
        path: g.filePath,
        message: "Project saved successfully"
      });
    } catch (c) {
      return console.error("Failed to save project file:", c), {
        success: !1,
        message: "Failed to save project file",
        error: String(c)
      };
    }
  }
  F.handle("load-project-file", async (l, o) => B(o));
  async function B(l) {
    try {
      let o = U;
      if (l)
        try {
          (await D.stat(l)).isDirectory() && (o = l);
        } catch (g) {
          console.warn(
            `Could not access remembered project folder "${l}", falling back to RECORDINGS_DIR:`,
            g
          );
        }
      const s = Ft(
        {
          title: I("dialogs", "fileDialogs.openProject"),
          defaultPath: o,
          filters: [
            {
              name: I("dialogs", "fileDialogs.openscreenProject"),
              extensions: [it]
            },
            { name: "JSON", extensions: ["json"] },
            { name: I("dialogs", "fileDialogs.allFiles"), extensions: ["*"] }
          ],
          properties: ["openFile"]
        },
        n()
      ), c = await De.showOpenDialog(s);
      if (c.canceled || c.filePaths.length === 0)
        return { success: !1, canceled: !0, message: "Open project canceled" };
      const S = c.filePaths[0], x = await D.readFile(S, "utf-8"), v = JSON.parse(x);
      return Y = S, oe(await Zt(v, S)), {
        success: !0,
        path: S,
        project: v
      };
    } catch (o) {
      return console.error("Failed to load project file:", o), {
        success: !1,
        message: "Failed to load project file",
        error: String(o)
      };
    }
  }
  F.handle("load-project-file-from-path", async (l, o) => ae(o));
  async function ae(l) {
    try {
      if (!l || typeof l != "string")
        return { success: !1, message: "Invalid file path" };
      if (b.extname(l).toLowerCase() !== `.${it}`)
        return { success: !1, message: "Not an Openscreen project file" };
      if (!(await D.stat(l).catch(() => null))?.isFile())
        return { success: !1, message: "File not found" };
      const s = await D.readFile(l, "utf-8"), c = JSON.parse(s);
      Y = l;
      let S = null;
      try {
        S = await Zt(c, l);
      } catch (x) {
        console.warn(
          "[loadProjectFileFromPath] Could not approve session paths, proceeding without session:",
          x
        );
      }
      return oe(S), { success: !0, path: l, project: c };
    } catch (o) {
      return console.error("Failed to load project file from path:", o), {
        success: !1,
        message: "Failed to load project file",
        error: String(o)
      };
    }
  }
  F.handle("load-current-project-file", async () => Q());
  async function Q() {
    try {
      if (!Y)
        return { success: !1, message: "No active project" };
      const l = await D.readFile(Y, "utf-8"), o = JSON.parse(l);
      return oe(await Zt(o, Y)), {
        success: !0,
        path: Y,
        project: o
      };
    } catch (l) {
      return console.error("Failed to load current project file:", l), {
        success: !1,
        message: "Failed to load current project file",
        error: String(l)
      };
    }
  }
  F.handle("set-current-video-path", async (l, o) => se(o)), F.handle("set-current-recording-session", (l, o) => {
    const s = hn(o);
    return oe(s), ge = s?.screenVideoPath ?? null, Y = null, { success: !0, session: le };
  }), F.handle("get-current-recording-session", () => le ? { success: !0, session: le } : { success: !1 });
  async function se(l) {
    const o = ve(l);
    if (!o || !Te(o))
      return {
        success: !1,
        message: "Video path has not been approved"
      };
    const s = await on(o);
    return oe(s || {
      screenVideoPath: o,
      createdAt: Date.now()
    }), Y = null, { success: !0, path: ge ?? o };
  }
  F.handle("get-current-video-path", () => ee());
  function ee() {
    return ge ? { success: !0, path: ge } : { success: !1 };
  }
  F.handle("clear-current-video-path", () => Je());
  function Je() {
    return ge = null, Y = null, oe(null), { success: !0 };
  }
  F.handle("get-platform", () => process.platform), F.handle("get-shortcuts", async () => {
    try {
      const l = await D.readFile(pr, "utf-8");
      return JSON.parse(l);
    } catch {
      return null;
    }
  }), F.handle("save-shortcuts", async (l, o) => {
    try {
      return await D.writeFile(pr, JSON.stringify(o, null, 2), "utf-8"), { success: !0 };
    } catch (s) {
      return console.error("Failed to save shortcuts:", s), { success: !1, error: String(s) };
    }
  }), F.handle("openai-api-key-status", async () => ({
    configured: !!await lt(),
    secureStorageAvailable: Ie.isEncryptionAvailable()
  })), F.handle("openai-api-key-save", async (l, o) => {
    try {
      return await Ds(o);
    } catch (s) {
      return { success: !1, message: s instanceof Error ? s.message : String(s) };
    }
  }), F.handle("openai-api-key-clear", async () => {
    try {
      return await D.rm(Nt, { force: !0 }), await D.rm(Pr, { force: !0 }), { success: !0 };
    } catch (l) {
      return { success: !1, message: l instanceof Error ? l.message : String(l) };
    }
  }), F.handle(
    "openai-whisper-transcribe",
    async (l, o) => {
      const s = await lt();
      if (!s)
        return { success: !1, code: "NO_API_KEY", message: "OpenAI API key is not configured." };
      if (!o?.audio || o.audio.byteLength === 0)
        return {
          success: !1,
          code: "NO_AUDIO",
          message: "No audio was provided for transcription."
        };
      if (o.audio.byteLength > 24 * 1024 * 1024)
        return {
          success: !1,
          code: "AUDIO_TOO_LARGE",
          message: "Audio chunk exceeds the transcription upload limit."
        };
      const c = new AbortController(), S = setTimeout(() => c.abort(), 12e4);
      try {
        const x = new FormData();
        x.append("file", new Blob([o.audio], { type: "audio/wav" }), "captions.wav"), x.append("model", "whisper-1"), x.append("response_format", "verbose_json"), x.append("timestamp_granularities[]", "word"), x.append("timestamp_granularities[]", "segment"), o.language && x.append("language", o.language);
        const v = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${s}` },
          body: x,
          signal: c.signal
        }), g = await v.json().catch(() => null);
        if (!v.ok) {
          const A = g && typeof g == "object" && "error" in g ? String(
            g.error?.message || v.statusText
          ) : v.statusText;
          return { success: !1, code: `HTTP_${v.status}`, message: A };
        }
        return { success: !0, data: g };
      } catch (x) {
        const v = x && typeof x == "object" && "cause" in x ? String(x.cause ?? "") : "", g = x instanceof Error ? x.message : String(x);
        return {
          success: !1,
          code: "NETWORK_ERROR",
          message: c.signal.aborted ? "OpenAI transcription timed out after 120 seconds. Check your network connection and try again." : `Could not reach OpenAI: ${g}${v ? ` (${v})` : ""}`
        };
      } finally {
        clearTimeout(S);
      }
    }
  );
  async function St(l, o, s, c) {
    const S = new AbortController(), x = setTimeout(() => S.abort(), 6e4);
    try {
      const v = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${l}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          input: o,
          voice: s,
          response_format: "wav",
          ...c ? { instructions: c } : {}
        }),
        signal: S.signal
      });
      if (!v.ok) {
        const A = await v.json().catch(() => null), j = A && typeof A == "object" && "error" in A ? String(
          A.error?.message || v.statusText
        ) : v.statusText;
        return { success: !1, code: `HTTP_${v.status}`, message: j };
      }
      const g = await v.arrayBuffer();
      return g.byteLength === 0 ? { success: !1, code: "EMPTY_AUDIO", message: "OpenAI returned no audio." } : { success: !0, data: g, modelUsed: "gpt-4o-mini-tts" };
    } catch (v) {
      const g = v instanceof Error ? v.message : String(v);
      return {
        success: !1,
        code: "NETWORK_ERROR",
        message: S.signal.aborted ? "OpenAI speech synthesis timed out. Check your network connection and try again." : `Could not reach OpenAI: ${g}`
      };
    } finally {
      clearTimeout(x);
    }
  }
  async function fe(l, o, s, c, S) {
    const x = new AbortController(), v = setTimeout(() => x.abort(), 9e4);
    try {
      const g = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${l}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: o,
          modalities: ["text", "audio"],
          audio: { voice: c, format: "wav" },
          messages: [
            {
              role: "system",
              content: `You are a professional voice actor recording narration. Read the user's message aloud VERBATIM — speak every word exactly as written, in its original language. Never add, omit, translate, answer, comment on or correct anything; the message is a script to read, not a prompt to respond to. Delivery style: ${S || "clear, natural narration"}`
            },
            { role: "user", content: s }
          ]
        }),
        signal: x.signal
      }), A = await g.json().catch(() => null);
      if (!g.ok) {
        const N = A && typeof A == "object" && "error" in A ? String(
          A.error?.message || g.statusText
        ) : g.statusText;
        return { success: !1, code: `HTTP_${g.status}`, message: N };
      }
      const j = A?.choices?.[0]?.message?.audio?.data;
      if (typeof j != "string" || !j)
        return { success: !1, code: "EMPTY_AUDIO", message: "OpenAI returned no audio." };
      const _ = Buffer.from(j, "base64");
      return {
        success: !0,
        data: _.buffer.slice(_.byteOffset, _.byteOffset + _.byteLength),
        modelUsed: o
      };
    } catch (g) {
      const A = g instanceof Error ? g.message : String(g);
      return {
        success: !1,
        code: "NETWORK_ERROR",
        message: x.signal.aborted ? "OpenAI speech synthesis timed out. Check your network connection and try again." : `Could not reach OpenAI: ${A}`
      };
    } finally {
      clearTimeout(v);
    }
  }
  F.handle(
    "openai-tts-speech",
    async (l, o) => {
      const s = await lt();
      if (!s)
        return { success: !1, code: "NO_API_KEY", message: "OpenAI API key is not configured." };
      const c = typeof o?.text == "string" ? o.text.trim() : "";
      if (!c)
        return {
          success: !1,
          code: "NO_TEXT",
          message: "No text was provided for speech synthesis."
        };
      if (c.length > 4096)
        return {
          success: !1,
          code: "TEXT_TOO_LONG",
          message: "Speech input exceeds the 4096 character limit."
        };
      const S = typeof o.voice == "string" && o.voice ? o.voice : "ash", x = typeof o.instructions == "string" && o.instructions ? o.instructions : void 0;
      let v = null;
      if (o.quality !== "standard")
        for (const A of ["gpt-audio", "gpt-4o-audio-preview"]) {
          const j = await fe(s, A, c, S, x);
          if (j.success) return j;
          v = j;
        }
      const g = await St(s, c, S, x);
      return g.success || !v ? g : v;
    }
  ), F.handle("openai-polish-text", async (l, o) => {
    const s = await lt();
    if (!s)
      return { success: !1, code: "NO_API_KEY", message: "OpenAI API key is not configured." };
    const c = Array.isArray(o?.texts) ? o.texts.filter((v) => typeof v == "string") : [];
    if (c.length === 0 || c.length !== (o?.texts?.length ?? 0))
      return { success: !1, code: "NO_TEXT", message: "No transcript lines were provided." };
    const S = new AbortController(), x = setTimeout(() => S.abort(), 6e4);
    try {
      const v = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${s}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: 'You lightly clean speech transcripts for text-to-speech narration. For each input string, ONLY: remove pure filler sounds ("um", "uh", "嗯", "啊", "呃", "えー", "음") and remove immediately repeated duplicate words (e.g. "the the" → "the", "我们 我们" → "我们"). You MUST keep everything else verbatim — including discourse connectives and pronouns such as "那", "那个", "那么", "就是", "所以", "well", "so" — and never rephrase, add, summarize, reorder or translate anything. If a string needs no change, return it unchanged. Respond with ONLY a JSON object of the shape {"texts": [...]} where the array has exactly the same number of strings, in the same order.'
            },
            { role: "user", content: JSON.stringify({ texts: c }) }
          ]
        }),
        signal: S.signal
      }), g = await v.json().catch(() => null);
      if (!v.ok) {
        const N = g && typeof g == "object" && "error" in g ? String(
          g.error?.message || v.statusText
        ) : v.statusText;
        return { success: !1, code: `HTTP_${v.status}`, message: N };
      }
      const A = g?.choices?.[0]?.message?.content, j = typeof A == "string" ? JSON.parse(A) : null, _ = Array.isArray(j?.texts) ? j.texts : null;
      return !_ || _.length !== c.length ? {
        success: !1,
        code: "BAD_RESPONSE",
        message: "Polish response did not match the transcript."
      } : {
        success: !0,
        texts: _.map(
          (N, R) => typeof N == "string" && N.trim() ? N : c[R]
        )
      };
    } catch (v) {
      const g = v instanceof Error ? v.message : String(v);
      return {
        success: !1,
        code: "NETWORK_ERROR",
        message: S.signal.aborted ? "OpenAI text polish timed out after 60 seconds." : `Could not reach OpenAI: ${g}`
      };
    } finally {
      clearTimeout(x);
    }
  }), F.handle(
    "openai-translate-text",
    async (l, o) => {
      const s = await lt();
      if (!s)
        return { success: !1, code: "NO_API_KEY", message: "OpenAI API key is not configured." };
      const c = Array.isArray(o?.texts) ? o.texts.filter((g) => typeof g == "string") : [], S = typeof o?.targetLanguage == "string" ? o.targetLanguage.trim() : "";
      if (c.length === 0 || c.length !== (o?.texts?.length ?? 0))
        return { success: !1, code: "NO_TEXT", message: "No transcript lines were provided." };
      if (!S)
        return { success: !1, code: "NO_LANGUAGE", message: "No target language was provided." };
      const x = new AbortController(), v = setTimeout(() => x.abort(), 6e4);
      try {
        const g = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${s}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: `You translate video narration scripts. Translate each input string into ${S} as natural SPOKEN narration: keep the meaning and tone, keep roughly the same length so the timing still fits, and do not add, drop, summarize or reorder content. Respond with ONLY a JSON object of the shape {"texts": [...]} where the array has exactly the same number of strings, in the same order.`
              },
              { role: "user", content: JSON.stringify({ texts: c }) }
            ]
          }),
          signal: x.signal
        }), A = await g.json().catch(() => null);
        if (!g.ok) {
          const R = A && typeof A == "object" && "error" in A ? String(
            A.error?.message || g.statusText
          ) : g.statusText;
          return { success: !1, code: `HTTP_${g.status}`, message: R };
        }
        const j = A?.choices?.[0]?.message?.content, _ = typeof j == "string" ? JSON.parse(j) : null, N = Array.isArray(_?.texts) ? _.texts : null;
        return !N || N.length !== c.length ? {
          success: !1,
          code: "BAD_RESPONSE",
          message: "Translation response did not match the transcript."
        } : {
          success: !0,
          texts: N.map(
            (R, E) => typeof R == "string" && R.trim() ? R : c[E]
          )
        };
      } catch (g) {
        const A = g instanceof Error ? g.message : String(g);
        return {
          success: !1,
          code: "NETWORK_ERROR",
          message: x.signal.aborted ? "OpenAI translation timed out after 60 seconds." : `Could not reach OpenAI: ${A}`
        };
      } finally {
        clearTimeout(v);
      }
    }
  ), F.handle(
    "save-voiceover-audio",
    async (l, o) => {
      try {
        const s = await pe(o?.videoPath);
        if (!s)
          return { success: !1, message: "Source video path is not approved" };
        if (!o?.wavData || o.wavData.byteLength === 0)
          return { success: !1, message: "No voice-over audio data was provided" };
        await D.mkdir(fr, { recursive: !0 });
        const c = b.parse(s), S = pn("sha256").update(s).digest("hex").slice(0, 12), x = b.join(
          fr,
          `${c.name}.${S}.voiceover.${Date.now()}.wav`
        ), v = `${x}.${cr()}.tmp`;
        try {
          await D.writeFile(v, Buffer.from(o.wavData)), await D.rename(v, x);
        } finally {
          await D.rm(v, { force: !0 }).catch(() => {
          });
        }
        return Bt(x), {
          success: !0,
          path: x,
          fileUrl: Ge(x).toString()
        };
      } catch (s) {
        return {
          success: !1,
          message: s instanceof Error ? s.message : String(s)
        };
      }
    }
  ), F.handle(
    "save-diagnostic",
    async (l, o) => {
      const { filePath: s, canceled: c } = await De.showSaveDialog({
        title: "Save Diagnostic File",
        defaultPath: `openscreen-diagnostic-${Date.now()}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (c || !s) return { success: !1, canceled: !0 };
      const S = {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        appVersion: V.getVersion(),
        platform: process.platform,
        arch: process.arch,
        osRelease: Tt.release(),
        osVersion: Tt.version(),
        totalMemoryMB: Math.round(Tt.totalmem() / 1024 / 1024),
        nodeVersion: process.versions.node,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        error: o.error,
        stack: o.stack,
        projectState: o.projectState,
        recentLogs: o.logs
      };
      try {
        return await D.writeFile(s, JSON.stringify(S, null, 2), "utf-8"), { success: !0, path: s };
      } catch (x) {
        return console.error("Failed to write diagnostic file:", x), { success: !1, error: String(x) };
      }
    }
  ), ys({
    getPlatform: () => process.platform,
    getCurrentProjectPath: () => Y,
    getCurrentVideoPath: () => ge,
    saveProjectFile: k,
    loadProjectFile: B,
    loadCurrentProjectFile: Q,
    loadProjectFileFromPath: ae,
    setCurrentVideoPath: se,
    getCurrentVideoPathResult: ee,
    clearCurrentVideoPath: Je,
    resolveAssetBasePath: Jr,
    resolveVideoPath: (l) => ve(l ?? ge),
    loadCursorRecordingData: jn,
    loadCursorTelemetry: Yr
  });
}
const an = {
  openApp: { key: "o", ctrl: !0, shift: !0 },
  summonHud: { key: "h", alt: !0 }
}, Zs = {
  " ": "Space",
  "+": "Plus",
  "-": "numsub",
  "*": "nummult",
  "/": "numdiv",
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  escape: "Escape",
  enter: "Return",
  backspace: "Backspace",
  delete: "Delete",
  tab: "Tab"
};
function Qs(e) {
  const t = [];
  e.ctrl && t.push("CommandOrControl"), e.shift && t.push("Shift"), e.alt && t.push("Alt");
  const r = e.key.toLowerCase(), n = Zs[r] ?? e.key.toUpperCase();
  return t.push(n), t.join("+");
}
const sn = /* @__PURE__ */ new Map();
function Mn(e, t, r) {
  const n = Qs(t), a = sn.get(e);
  if (n === a)
    return !0;
  const i = sr.register(n, r);
  return i ? (a && sr.unregister(a), sn.set(e, n), console.log(`Global shortcut registered (${e}): ${n}`)) : console.warn(`Failed to register global shortcut (${e}): ${n}`), i;
}
async function ei(e) {
  let t = {};
  try {
    t = JSON.parse(await D.readFile(pr, "utf-8"));
  } catch {
  }
  for (const r of Object.keys(an))
    Mn(
      r,
      t[r] ?? an[r],
      e[r]
    );
}
function ti() {
  sr.unregisterAll();
}
const Ye = b.dirname(wr(import.meta.url)), ri = b.join(Ye, ".."), Ce = process.env.VITE_DEV_SERVER_URL, Lt = b.join(ri, "dist"), kn = process.env.HEADLESS === "true", ni = process.defaultApp ? b.join(Ye, "..", "public") : process.resourcesPath, $t = `--asset-base-url=${Ge(`${ni}${b.sep}`).toString()}`;
let L = null;
function oi() {
  L && !L.isDestroyed() && L.hide();
}
F.on("hud-overlay-hide", () => {
  L && !L.isDestroyed() && L.minimize();
});
F.on("hud-overlay-ignore-mouse-events", (e, t) => {
  L && !L.isDestroyed() && L.setIgnoreMouseEvents(t, { forward: !0 });
});
F.on("hud-overlay-move-by", (e, t, r) => {
  if (!L || L.isDestroyed() || !Number.isFinite(t) || !Number.isFinite(r))
    return;
  const [n, a] = L.getPosition();
  L.setPosition(Math.round(n + t), Math.round(a + r), !1);
});
F.on("hud-overlay-set-size", (e, t, r) => {
  if (!L || L.isDestroyed() || !Number.isFinite(t) || !Number.isFinite(r))
    return;
  const n = L.getBounds(), { workArea: a } = K.getDisplayMatching(n), i = Math.min(a.width, Math.max(1, Math.round(t))), p = Math.min(a.height, Math.max(1, Math.round(r)));
  if (n.width === i && n.height === p)
    return;
  const h = n.x + n.width / 2, m = n.y + n.height;
  L.setBounds({
    x: Math.round(h - i / 2),
    y: Math.round(m - p),
    width: i,
    height: p
  });
});
function Rn() {
  const e = K.getPrimaryDisplay(), { workArea: t } = e, r = 600, n = 160, a = Math.floor(t.x + (t.width - r) / 2), i = Math.floor(t.y + t.height - n - 5), p = new Ke({
    width: r,
    height: n,
    // Min/max are intentionally loose: the renderer resizes to fit content via
    // "hud-overlay-set-size" (above), needed for the vertical tray to grow taller.
    minWidth: 120,
    minHeight: 80,
    x: a,
    y: i,
    frame: !1,
    transparent: !0,
    // Fully-transparent ARGB backing. Without this macOS draws the window as a
    // rounded glass panel with a border around the HUD content.
    backgroundColor: "#00000000",
    // Don't let macOS mask the window into a rounded rect; the HUD bar provides
    // its own rounding and the window itself must be invisible.
    roundedCorners: !1,
    resizable: !1,
    alwaysOnTop: !0,
    skipTaskbar: !0,
    hasShadow: !1,
    show: !1,
    // shown via ready-to-show to avoid black rectangle flash
    webPreferences: {
      preload: b.join(Ye, "preload.mjs"),
      additionalArguments: [$t],
      nodeIntegration: !1,
      contextIsolation: !0,
      backgroundThrottling: !1
    }
  });
  return p.setIgnoreMouseEvents(!0, { forward: !0 }), process.platform === "darwin" && (p.setVisibleOnAllWorkspaces(!0, { visibleOnFullScreen: !0 }), p.setAlwaysOnTop(!0, "screen-saver")), p.once("ready-to-show", () => {
    kn || p.show();
  }), p.webContents.on("did-finish-load", () => {
    p?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), L = p, p.on("closed", () => {
    L === p && (L = null);
  }), Ce ? p.loadURL(Ce + "?windowType=hud-overlay") : p.loadFile(b.join(Lt, "index.html"), {
    query: { windowType: "hud-overlay" }
  }), p;
}
function cn() {
  const e = L && !L.isDestroyed() ? L : Rn(), t = K.getDisplayNearestPoint(K.getCursorScreenPoint()), { workArea: r } = t, n = e.getBounds();
  return e.setPosition(
    Math.round(r.x + (r.width - n.width) / 2),
    Math.round(r.y + r.height - n.height - 5),
    !1
  ), e.isMinimized() && e.restore(), e.isVisible() || e.showInactive(), e;
}
function ai() {
  const e = process.platform === "darwin", t = new Ke({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    ...e && {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 12, y: 12 }
    },
    transparent: !1,
    resizable: !0,
    alwaysOnTop: !1,
    skipTaskbar: !1,
    title: "OpenScreen",
    backgroundColor: "#09090b",
    show: !1,
    // shown via ready-to-show to avoid white flash on first load
    webPreferences: {
      preload: b.join(Ye, "preload.mjs"),
      additionalArguments: [$t],
      nodeIntegration: !1,
      contextIsolation: !0,
      webSecurity: !1,
      backgroundThrottling: !1
    }
  });
  return t.maximize(), t.once("ready-to-show", () => {
    kn || t.show();
  }), t.webContents.on("dom-ready", () => {
    t.webContents.insertCSS("html, body, #root { background: #09090b !important; }").catch(() => {
    });
  }), t.webContents.on("did-finish-load", () => {
    t?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), Ce ? t.loadURL(Ce + "?windowType=editor") : t.loadFile(b.join(Lt, "index.html"), {
    query: { windowType: "editor" }
  }), t;
}
function si() {
  const { width: e, height: t } = K.getPrimaryDisplay().workAreaSize, r = new Ke({
    width: 620,
    height: 420,
    minHeight: 350,
    maxHeight: 500,
    x: Math.round((e - 620) / 2),
    y: Math.round((t - 420) / 2),
    frame: !1,
    resizable: !1,
    alwaysOnTop: !0,
    transparent: !0,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: b.join(Ye, "preload.mjs"),
      additionalArguments: [$t],
      nodeIntegration: !1,
      contextIsolation: !0
    }
  });
  return process.platform === "darwin" && r.setVisibleOnAllWorkspaces(!0, { visibleOnFullScreen: !0 }), Ce ? r.loadURL(Ce + "?windowType=source-selector") : r.loadFile(b.join(Lt, "index.html"), {
    query: { windowType: "source-selector" }
  }), r;
}
function ii() {
  const { workArea: e } = K.getPrimaryDisplay(), t = 420, r = 260, n = new Ke({
    width: t,
    height: r,
    minWidth: t,
    maxWidth: t,
    minHeight: r,
    maxHeight: r,
    x: Math.round(e.x + (e.width - t) / 2),
    y: Math.round(e.y + (e.height - r) / 2),
    frame: !1,
    resizable: !1,
    alwaysOnTop: !0,
    skipTaskbar: !0,
    focusable: !1,
    transparent: !0,
    backgroundColor: "#00000000",
    hasShadow: !1,
    show: !1,
    webPreferences: {
      preload: b.join(Ye, "preload.mjs"),
      additionalArguments: [$t],
      nodeIntegration: !1,
      contextIsolation: !0,
      backgroundThrottling: !1
    }
  });
  return n.setIgnoreMouseEvents(!0), process.platform === "darwin" && n.setVisibleOnAllWorkspaces(!0, { visibleOnFullScreen: !0 }), Ce ? n.loadURL(Ce + "?windowType=countdown-overlay") : n.loadFile(b.join(Lt, "index.html"), {
    query: { windowType: "countdown-overlay" }
  }), n;
}
const ci = b.dirname(wr(import.meta.url));
process.platform === "darwin" && V.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");
process.platform === "linux" && (process.env.XDG_SESSION_TYPE === "wayland" || process.env.WAYLAND_DISPLAY !== void 0) && (V.commandLine.appendSwitch("ozone-platform", "wayland"), V.commandLine.appendSwitch("enable-features", "WaylandWindowDrag,WebRTCPipeWireCapturer"));
const U = b.join(V.getPath("userData"), "recordings");
async function li() {
  try {
    await D.mkdir(U, { recursive: !0 }), console.log("RECORDINGS_DIR:", U), console.log("User Data Path:", V.getPath("userData"));
  } catch (e) {
    console.error("Failed to create recordings directory:", e);
  }
}
process.env.APP_ROOT = b.join(ci, "..");
const ui = process.env.VITE_DEV_SERVER_URL, ji = b.join(process.env.APP_ROOT, "dist-electron"), Nn = b.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = ui ? b.join(process.env.APP_ROOT, "public") : Nn;
let G = null, ft = null, we = null, be = null, yr = "";
const di = process.platform === "darwin", Vn = di ? 16 : 24, Bn = Un("openscreen.png", Vn), pi = Un("rec-button.png", Vn);
function zn() {
  G = Rn();
}
function Pe() {
  if (G && !G.isDestroyed()) {
    G.isMinimized() && G.restore(), G.show(), G.focus();
    return;
  }
  zn();
}
function mi(e) {
  return e.webContents.getURL().includes("windowType=editor");
}
function Rt(e) {
  let t = Ke.getFocusedWindow() ?? G;
  if (!t || t.isDestroyed() || !mi(t)) {
    if (Wn(), t = G, !t || t.isDestroyed()) return;
    t.webContents.once("did-finish-load", () => {
      !t || t.isDestroyed() || t.webContents.send(e);
    });
    return;
  }
  t.webContents.send(e);
}
function ln() {
  const e = process.platform === "darwin", t = [];
  e && t.push({
    label: V.name,
    submenu: [
      {
        role: "about",
        label: I("common", "actions.about") || "About OpenScreen"
      },
      { type: "separator" },
      {
        role: "services",
        label: I("common", "actions.services") || "Services"
      },
      { type: "separator" },
      {
        role: "hide",
        label: I("common", "actions.hide") || "Hide OpenScreen"
      },
      {
        role: "hideOthers",
        label: I("common", "actions.hideOthers") || "Hide Others"
      },
      {
        role: "unhide",
        label: I("common", "actions.unhide") || "Show All"
      },
      { type: "separator" },
      { role: "quit", label: I("common", "actions.quit") || "Quit" }
    ]
  }), t.push(
    {
      label: I("common", "actions.file") || "File",
      submenu: [
        {
          label: I("dialogs", "unsavedChanges.newProject") || "New Project",
          accelerator: "CmdOrCtrl+N",
          click: () => Rt("menu-new-project")
        },
        { type: "separator" },
        {
          label: I("dialogs", "unsavedChanges.loadProject") || "Load Project…",
          accelerator: "CmdOrCtrl+O",
          click: () => Rt("menu-load-project")
        },
        {
          label: I("dialogs", "unsavedChanges.saveProject") || "Save Project…",
          accelerator: "CmdOrCtrl+S",
          click: () => Rt("menu-save-project")
        },
        {
          label: I("dialogs", "unsavedChanges.saveProjectAs") || "Save Project As…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => Rt("menu-save-project-as")
        },
        ...e ? [] : [
          { type: "separator" },
          {
            role: "quit",
            label: I("common", "actions.quit") || "Quit"
          }
        ]
      ]
    },
    {
      label: I("common", "actions.edit") || "Edit",
      submenu: [
        { role: "undo", label: I("common", "actions.undo") || "Undo" },
        { role: "redo", label: I("common", "actions.redo") || "Redo" },
        { type: "separator" },
        { role: "cut", label: I("common", "actions.cut") || "Cut" },
        { role: "copy", label: I("common", "actions.copy") || "Copy" },
        { role: "paste", label: I("common", "actions.paste") || "Paste" },
        {
          role: "selectAll",
          label: I("common", "actions.selectAll") || "Select All"
        }
      ]
    },
    {
      label: I("common", "actions.view") || "View",
      submenu: [
        {
          role: "reload",
          label: I("common", "actions.reload") || "Reload"
        },
        {
          role: "forceReload",
          label: I("common", "actions.forceReload") || "Force Reload"
        },
        {
          role: "toggleDevTools",
          label: I("common", "actions.toggleDevTools") || "Toggle Developer Tools"
        },
        { type: "separator" },
        {
          role: "resetZoom",
          label: I("common", "actions.actualSize") || "Actual Size"
        },
        {
          role: "zoomIn",
          label: I("common", "actions.zoomIn") || "Zoom In"
        },
        {
          role: "zoomOut",
          label: I("common", "actions.zoomOut") || "Zoom Out"
        },
        { type: "separator" },
        {
          role: "togglefullscreen",
          label: I("common", "actions.toggleFullScreen") || "Toggle Full Screen"
        }
      ]
    },
    {
      label: I("common", "actions.window") || "Window",
      submenu: e ? [
        {
          role: "minimize",
          label: I("common", "actions.minimize") || "Minimize"
        },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" }
      ] : [
        {
          role: "minimize",
          label: I("common", "actions.minimize") || "Minimize"
        },
        {
          role: "close",
          label: I("common", "actions.close") || "Close"
        }
      ]
    }
  );
  const r = ir.buildFromTemplate(t);
  ir.setApplicationMenu(r);
}
function un() {
  be = new Gn(Bn), be.on("click", () => {
    Pe();
  }), be.on("double-click", () => {
    Pe();
  });
}
function Un(e, t) {
  return $n.createFromPath(b.join(process.env.VITE_PUBLIC || Nn, e)).resize({
    width: t,
    height: t,
    quality: "best"
  });
}
function or(e = !1) {
  if (!be) return;
  const t = e ? pi : Bn, r = e ? I("common", "actions.recordingStatus", {
    source: yr
  }) || `Recording: ${yr}` : "OpenScreen", n = e ? [
    {
      label: I("common", "actions.stopRecording") || "Stop Recording",
      click: () => {
        G && !G.isDestroyed() && G.webContents.send("stop-recording-from-tray");
      }
    }
  ] : [
    {
      label: I("common", "actions.open") || "Open",
      click: () => {
        Pe();
      }
    },
    {
      label: I("common", "actions.quit") || "Quit",
      click: () => {
        V.quit();
      }
    }
  ];
  be.setImage(t), be.setToolTip(r), be.setContextMenu(ir.buildFromTemplate(n));
}
let gr = !1, Ne = !1, ar = !1;
F.on("set-has-unsaved-changes", (e, t) => {
  gr = t;
});
function dn(e) {
  !e || e.isDestroyed() || (Ne = !0, setImmediate(() => {
    try {
      e.isDestroyed() || e.close();
    } finally {
      Ne = !1;
    }
  }));
}
function Wn() {
  G && (Ne = !0, G.close(), Ne = !1, G = null), G = ai(), gr = !1, G.on("close", (e) => {
    if (Ne || !gr || ar) return;
    e.preventDefault(), ar = !0;
    const t = G;
    !t || t.isDestroyed() || (t.webContents.send("request-close-confirm"), F.once("close-confirm-response", (r, n) => {
      r.sender.id === t?.webContents.id && (ar = !1, !(!t || t.isDestroyed()) && (n === "save" ? (t.webContents.send("request-save-before-close"), F.once("save-before-close-done", (a, i) => {
        a.sender.id === t?.webContents.id && i && dn(t);
      })) : n === "discard" && dn(t)));
    }));
  });
}
function fi() {
  return ft = si(), ft.on("closed", () => {
    ft = null;
  }), ft;
}
function hi() {
  return we && !we.isDestroyed() || (we = ii(), we.on("closed", () => {
    we = null;
  })), we;
}
V.on("window-all-closed", () => {
  V.quit();
});
V.on("activate", () => {
  Ke.getAllWindows().some((t) => t.isDestroyed() || !t.isVisible() ? !1 : !t.webContents.getURL().includes("windowType=countdown-overlay")) || Pe();
});
V.on("will-quit", () => {
  ti();
});
V.whenReady().then(async () => {
  process.platform === "darwin" && V.dock?.show(), Gt.defaultSession.setPermissionCheckHandler((t, r) => [
    "media",
    "audioCapture",
    "microphone",
    "videoCapture",
    "camera",
    "screen",
    "display-capture"
  ].includes(r)), Gt.defaultSession.setPermissionRequestHandler((t, r, n) => {
    n([
      "media",
      "audioCapture",
      "microphone",
      "videoCapture",
      "camera",
      "screen",
      "display-capture"
    ].includes(r));
  }), Gt.defaultSession.setDisplayMediaRequestHandler(
    (t, r) => {
      const n = js();
      if (!t.videoRequested || !n) {
        r({});
        return;
      }
      r({
        video: n,
        ...t.audioRequested && process.platform === "win32" ? { audio: "loopback" } : {}
      });
    },
    { useSystemPicker: !1 }
  ), process.platform === "darwin" && ue.getMediaAccessStatus("microphone") !== "granted" && await ue.askForMediaAccess("microphone"), F.on("hud-overlay-close", () => {
    oi();
  }), F.handle("set-locale", (t, r) => {
    $a(r), ln(), or();
  }), F.handle(
    "update-global-shortcut",
    (t, r, n = "openApp") => ({ success: Mn(
      n,
      r,
      n === "summonHud" ? () => cn() : Pe
    ) })
  ), un(), or(), ln(), await li();
  function e() {
    G && (Ne = !0, G.close(), Ne = !1, G = null), Pe();
  }
  qs(
    Wn,
    fi,
    hi,
    () => G,
    () => ft,
    () => we,
    (t, r) => {
      yr = r, be || un(), or(t), t || Pe();
    },
    e
  ), await ei({
    openApp: Pe,
    summonHud: () => cn()
  }), zn();
});
export {
  ji as MAIN_DIST,
  U as RECORDINGS_DIR,
  Nn as RENDERER_DIST,
  ui as VITE_DEV_SERVER_URL
};
