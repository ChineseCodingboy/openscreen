import D, { unlink as Bn } from "node:fs/promises";
import S, { join as Sr } from "node:path";
import { pathToFileURL as Le, fileURLToPath as hr } from "node:url";
import { screen as G, app as N, ipcMain as C, desktopCapturer as St, systemPreferences as ge, dialog as De, shell as bt, safeStorage as Ie, globalShortcut as ar, BrowserWindow as Ge, nativeImage as zn, session as $t, Menu as sr, Tray as Un } from "electron";
import { spawn as Ve } from "node:child_process";
import { randomUUID as br, createHash as Wn } from "node:crypto";
import { EventEmitter as Ln } from "node:events";
import { accessSync as $n, constants as gt, existsSync as Gn, createWriteStream as Hn, createReadStream as Kn } from "node:fs";
import { createServer as Yn } from "node:http";
import Pt from "node:os";
const Pr = 1e-3;
function Tt(e) {
  return typeof e == "number" && Number.isFinite(e);
}
function Jn(e) {
  if (!e || typeof e != "object") return null;
  const t = e;
  return !Tt(t.screenStartMs) || !Tt(t.screenEndMs) || !Tt(t.webcamStartMs) || !Tt(t.webcamEndMs) || t.screenStartMs < 0 || t.webcamStartMs < 0 || t.screenEndMs - t.screenStartMs < Pr || t.webcamEndMs - t.webcamStartMs < Pr ? null : {
    screenStartMs: t.screenStartMs,
    screenEndMs: t.screenEndMs,
    webcamStartMs: t.webcamStartMs,
    webcamEndMs: t.webcamEndMs
  };
}
function Xn(e) {
  if (!e || typeof e != "object") return;
  const t = e;
  if (t.schemaVersion !== 1 && t.version !== 1 || !Array.isArray(t.segments)) return;
  const r = t.segments.map(Jn).filter((a) => a !== null).sort((a, s) => a.screenStartMs - s.screenStartMs), n = [];
  for (const a of r) {
    const s = n.at(-1);
    s && (a.screenStartMs < s.screenEndMs || a.webcamStartMs < s.webcamEndMs) || n.push(a);
  }
  return n.length > 0 ? { schemaVersion: 1, segments: n } : void 0;
}
function Ue(e) {
  return e === "editable-overlay" || e === "system" ? e : void 0;
}
function qn(e) {
  if (!Array.isArray(e))
    return;
  const t = [];
  for (const r of e)
    (r === "system" || r === "microphone") && !t.includes(r) && t.push(r);
  return t.length > 0 ? t : void 0;
}
function Zn(e) {
  if (!Array.isArray(e)) return;
  const t = /* @__PURE__ */ new Map();
  for (const n of e) {
    if (!n || typeof n != "object") continue;
    const a = n;
    if (typeof a.ordinal != "number" || !Number.isFinite(a.ordinal) || !Qn(a.role)) continue;
    const s = Math.max(0, Math.round(a.ordinal));
    t.has(s) || t.set(s, { ordinal: s, role: a.role });
  }
  const r = [...t.values()].sort((n, a) => n.ordinal - a.ordinal);
  return r.length > 0 ? r : void 0;
}
function Qn(e) {
  return e === "system" || e === "microphone" || e === "mixed" || e === "unknown" || e === "voiceover";
}
function Tr(e) {
  if (typeof e != "string")
    return;
  const t = e.trim();
  return t || void 0;
}
function un(e) {
  if (!e || typeof e != "object")
    return null;
  const t = e, r = Tr(t.screenVideoPath);
  if (!r)
    return null;
  const n = Tr(t.webcamVideoPath), a = n ? Xn(t.webcamSync) : void 0, s = Ue(t.cursorCaptureMode), p = Zn(t.audioTracks), m = qn(t.audioStreams), f = p ?? (m?.length === 1 ? m.map((b, F) => ({ ordinal: F, role: b })) : void 0);
  return {
    screenVideoPath: r,
    ...n ? { webcamVideoPath: n } : {},
    ...a ? { webcamSync: a } : {},
    ...s ? { cursorCaptureMode: s } : {},
    ...f ? { audioTracks: f } : {},
    // Retain v4 requested-source metadata until the renderer has inspected the
    // physical file; two requested sources may be one mixed track or two tracks.
    ...m && !p ? { audioStreams: m } : {}
  };
}
function dn(e) {
  if (!e || typeof e != "object")
    return null;
  const t = e, r = un(t);
  return r ? {
    ...r,
    createdAt: typeof t.createdAt == "number" && Number.isFinite(t.createdAt) ? t.createdAt : Date.now()
  } : null;
}
const eo = { cancel: "الغاء", save: "حفظ", delete: "حذف", close: "اغلاق", share: "مشاركة", done: "تم", open: "فتح", upload: "رفع", export: "تصدير", showInFolder: "عرض في المجلد", file: "ملف", edit: "تعديل", view: "عرض", window: "نافذة", quit: "خروج", stopRecording: "إيقاف التسجيل", undo: "تراجع", redo: "إعادة", cut: "قص", copy: "نسخ", paste: "لصق", selectAll: "تحديد الكل", minimize: "تصغير", reload: "إعادة تحميل", forceReload: "إعادة تحميل إجبارية", toggleDevTools: "أدوات المطور", actualSize: "الحجم الفعلي", zoomIn: "تكبير", zoomOut: "تصغير", toggleFullScreen: "ملء الشاشة", recordingStatus: "جاري التسجيل: {{source}}", about: "حول OpenScreen", services: "خدمات", hide: "إخفاء OpenScreen", hideOthers: "إخفاء الآخرين", unhide: "إظهار الكل" }, to = { play: "تشغيل", pause: "ايقاف مؤقت", fullscreen: "ملء الشاشة", exitFullscreen: "خروج من ملء الشاشة" }, ro = { name: "عربي", short: "AR" }, no = {
  actions: eo,
  playback: to,
  locale: ro
}, oo = { triggerLabel: "كيف يعمل القص", title: "كيف يعمل القص", description: "فهم كيفية قص الأجزاء غير المرغوب فيها من الفيديو الخاص بك.", explanationBefore: "تعمل أداة القص من خلال تحديد المقاطع التي تريد", remove: "إزالتها", explanationMiddle: " — أي شيء", covered: "مغطى", explanationAfter: "بمقطع قص أحمر سيتم قصه عند التصدير.", visualExample: "مثال مرئي", removed: "مُزال", kept: "مُحتفظ به", part1: "الجزء 1", part2: "الجزء 2", part3: "الجزء 3", finalVideo: "الفيديو النهائي", step1Title: "1. إضافة قص", step1DescriptionBefore: "اضغط على ", step1DescriptionAfter: " أو انقر على أيقونة المقص لتحديد قسم لإزالته.", step2Title: "2. تعديل", step2Description: "اسحب حواف المنطقة الحمراء لتغطي بالضبط ما تريد قصه." }, ao = { title: "تغييرات غير محفوظة", message: "لديك تغييرات غير محفوظة.", detail: "هل تريد حفظ مشروعك قبل الإغلاق؟", saveAndClose: "حفظ وإغلاق", discardAndClose: "تجاهل وإغلاق", detailNewProject: "هل تريد حفظ مشروعك قبل إنشاء مشروع جديد؟", saveAndNewProject: "حفظ وإنشاء مشروع جديد", discardAndNewProject: "تجاهل وإنشاء مشروع جديد", detailLoadProject: "هل تريد حفظ مشروعك قبل تحميل مشروع آخر؟", saveAndLoadProject: "حفظ وتحميل مشروع", discardAndLoadProject: "تجاهل وتحميل مشروع", loadProject: "تحميل مشروع...", saveProject: "حفظ المشروع...", saveProjectAs: "حفظ المشروع باسم...", newProject: "مشروع جديد", importVideo: "استيراد ملف فيديو…" }, so = { saveGif: "حفظ GIF المصدر", saveVideo: "حفظ الفيديو المصدر", selectVideo: "حدد ملف فيديو", saveProject: "حفظ مشروع OpenScreen", openProject: "فتح مشروع OpenScreen", gifImage: "صورة GIF", mp4Video: "فيديو MP4", videoFiles: "ملفات فيديو", openscreenProject: "مشروع OpenScreen", allFiles: "جميع الملفات" }, io = {
  export: { complete: "اكتمل التصدير", yourFormatReady: "{{format}} الخاص بك جاهز", showInFolder: "عرض في المجلد", finalizingVideo: "جاري إنهاء تصدير الفيديو...", compilingGifProgress: "جاري تجميع GIF... {{progress}}%", compilingGifWait: "جاري تجميع GIF... قد يستغرق هذا بعض الوقت", takeMoment: "قد يستغرق هذا لحظة...", failed: "فشل التصدير", tryAgain: "يرجى المحاولة مرة أخرى", finalizingVideoTitle: "إنهاء الفيديو", compilingGif: "تجميع GIF", exportingFormat: "تصدير {{format}}", compiling: "تجميع", renderingFrames: "تصيير الإطارات", processing: "جاري المعالجة...", finalizing: "جاري الإنهاء...", compilingStatus: "جاري التجميع...", status: "الحالة", format: "الصيغة", frames: "الإطارات", cancelExport: "إلغاء التصدير", savedSuccessfully: "تم حفظ {{format}} بنجاح!" },
  tutorial: oo,
  unsavedChanges: ao,
  fileDialogs: so
}, co = { cancel: "Cancel", save: "Save", delete: "Delete", close: "Close", share: "Share", done: "Done", open: "Open", upload: "Upload", export: "Export", showInFolder: "Show in Folder", file: "File", edit: "Edit", view: "View", window: "Window", quit: "Quit", stopRecording: "Stop Recording", undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select All", minimize: "Minimize", reload: "Reload", forceReload: "Force Reload", toggleDevTools: "Toggle Developer Tools", actualSize: "Actual Size", zoomIn: "Zoom In", zoomOut: "Zoom Out", toggleFullScreen: "Toggle Full Screen", recordingStatus: "Recording: {{source}}", about: "About OpenScreen", services: "Services", hide: "Hide OpenScreen", hideOthers: "Hide Others", unhide: "Show All" }, lo = { play: "Play", pause: "Pause", fullscreen: "Fullscreen", exitFullscreen: "Exit Fullscreen" }, uo = { name: "English", short: "EN" }, po = {
  actions: co,
  playback: lo,
  locale: uo
}, mo = { triggerLabel: "How trimming works", title: "How Trimming Works", description: "Understanding how to cut out unwanted parts of your video.", explanationBefore: "The Trim tool works by defining the segments you want to", remove: "remove", explanationMiddle: " — anything", covered: "covered", explanationAfter: "by a red trim segment will be cut out when you export.", visualExample: "Visual Example", removed: "REMOVED", kept: "Kept", part1: "Part 1", part2: "Part 2", part3: "Part 3", finalVideo: "Final Video", step1Title: "1. Add Trim", step1DescriptionBefore: "Press ", step1DescriptionAfter: " or click the scissors icon to mark a section for removal.", step2Title: "2. Adjust", step2Description: "Drag the edges of the red region to cover exactly what you want to cut out." }, fo = { title: "Unsaved Changes", message: "You have unsaved changes.", detail: "Do you want to save your project before closing?", saveAndClose: "Save & Close", discardAndClose: "Discard & Close", detailNewProject: "Do you want to save your project before creating a new one?", saveAndNewProject: "Save & New Project", discardAndNewProject: "Discard & New Project", detailLoadProject: "Do you want to save your project before loading another one?", saveAndLoadProject: "Save & Load Project", discardAndLoadProject: "Discard & Load Project", newProject: "New Project", importVideo: "Import Video File…", loadProject: "Load Project…", saveProject: "Save Project…", saveProjectAs: "Save Project As…" }, ho = { saveGif: "Save Exported GIF", saveVideo: "Save Exported Video", selectVideo: "Select Video File", saveProject: "Save OpenScreen Project", openProject: "Open OpenScreen Project", gifImage: "GIF Image", mp4Video: "MP4 Video", videoFiles: "Video Files", openscreenProject: "OpenScreen Project", allFiles: "All Files" }, yo = {
  export: { complete: "Export Complete", yourFormatReady: "Your {{format}} is ready", showInFolder: "Show in Folder", finalizingVideo: "Finalizing video export...", compilingGifProgress: "Compiling GIF... {{progress}}%", compilingGifWait: "Compiling GIF... This may take a while", takeMoment: "This may take a moment...", failed: "Export Failed", tryAgain: "Please try again", finalizingVideoTitle: "Finalizing Video", compilingGif: "Compiling GIF", exportingFormat: "Exporting {{format}}", compiling: "Compiling", renderingFrames: "Rendering Frames", processing: "Processing...", finalizing: "Finalizing...", compilingStatus: "Compiling...", status: "Status", format: "Format", frames: "Frames", cancelExport: "Cancel Export", savedSuccessfully: "{{format}} saved successfully!" },
  tutorial: mo,
  unsavedChanges: fo,
  fileDialogs: ho
}, go = { cancel: "Cancelar", save: "Guardar", delete: "Eliminar", close: "Cerrar", share: "Compartir", done: "Listo", open: "Abrir", upload: "Subir", export: "Exportar", showInFolder: "Mostrar en carpeta", file: "Archivo", edit: "Editar", view: "Vista", window: "Ventana", quit: "Salir", stopRecording: "Detener grabación", undo: "Deshacer", redo: "Rehacer", cut: "Cortar", copy: "Copiar", paste: "Pegar", selectAll: "Seleccionar todo", minimize: "Minimizar", reload: "Recargar", forceReload: "Forzar recarga", toggleDevTools: "Alternar herramientas de desarrollador", actualSize: "Tamaño real", zoomIn: "Acercar", zoomOut: "Alejar", toggleFullScreen: "Alternar pantalla completa", recordingStatus: "Grabando: {{source}}", about: "Acerca de OpenScreen", services: "Servicios", hide: "Ocultar OpenScreen", hideOthers: "Ocultar otros", unhide: "Mostrar todo" }, wo = { play: "Reproducir", pause: "Pausar", fullscreen: "Pantalla completa", exitFullscreen: "Salir de pantalla completa" }, vo = { name: "Español", short: "ES" }, So = {
  actions: go,
  playback: wo,
  locale: vo
}, bo = { triggerLabel: "Cómo funciona el recorte", title: "Cómo funciona el recorte", description: "Aprende a eliminar las partes no deseadas de tu video.", explanationBefore: "La herramienta de recorte funciona definiendo los segmentos que deseas", remove: "eliminar", explanationMiddle: " — cualquier parte", covered: "cubierta", explanationAfter: "por un segmento rojo será eliminada al exportar.", visualExample: "Ejemplo visual", removed: "ELIMINADO", kept: "Conservado", part1: "Parte 1", part2: "Parte 2", part3: "Parte 3", finalVideo: "Video final", step1Title: "1. Agregar recorte", step1DescriptionBefore: "Presiona ", step1DescriptionAfter: " o haz clic en el ícono de tijeras para marcar una sección a eliminar.", step2Title: "2. Ajustar", step2Description: "Arrastra los bordes de la región roja para cubrir exactamente lo que deseas eliminar." }, Po = { title: "Cambios sin guardar", message: "Tienes cambios sin guardar.", detail: "¿Deseas guardar tu proyecto antes de cerrar?", saveAndClose: "Guardar y cerrar", discardAndClose: "Descartar y cerrar", detailNewProject: "¿Deseas guardar tu proyecto antes de crear uno nuevo?", saveAndNewProject: "Guardar y nuevo proyecto", discardAndNewProject: "Descartar y nuevo proyecto", detailLoadProject: "¿Deseas guardar tu proyecto antes de cargar otro?", saveAndLoadProject: "Guardar y cargar proyecto", discardAndLoadProject: "Descartar y cargar proyecto", loadProject: "Cargar proyecto…", saveProject: "Guardar proyecto…", saveProjectAs: "Guardar proyecto como…", newProject: "Nuevo proyecto", importVideo: "Importar archivo de vídeo…" }, To = { saveGif: "Guardar GIF exportado", saveVideo: "Guardar video exportado", selectVideo: "Seleccionar archivo de video", saveProject: "Guardar proyecto OpenScreen", openProject: "Abrir proyecto OpenScreen", gifImage: "Imagen GIF", mp4Video: "Video MP4", videoFiles: "Archivos de video", openscreenProject: "Proyecto OpenScreen", allFiles: "Todos los archivos" }, xo = {
  export: { complete: "Exportación completada", yourFormatReady: "Tu {{format}} está listo", showInFolder: "Mostrar en carpeta", finalizingVideo: "Finalizando exportación de video...", compilingGifProgress: "Compilando GIF... {{progress}}%", compilingGifWait: "Compilando GIF... Esto puede tardar un rato", takeMoment: "Esto puede tardar un momento...", failed: "La exportación falló", tryAgain: "Por favor intenta de nuevo", finalizingVideoTitle: "Finalizando video", compilingGif: "Compilando GIF", exportingFormat: "Exportando {{format}}", compiling: "Compilando", renderingFrames: "Renderizando cuadros", processing: "Procesando...", finalizing: "Finalizando...", compilingStatus: "Compilando...", status: "Estado", format: "Formato", frames: "Cuadros", cancelExport: "Cancelar exportación", savedSuccessfully: "¡{{format}} guardado exitosamente!" },
  tutorial: bo,
  unsavedChanges: Po,
  fileDialogs: To
}, Co = { cancel: "Annuler", save: "Enregistrer", delete: "Supprimer", close: "Fermer", share: "Partager", done: "Terminer", open: "Ouvrir", upload: "Téléverser", export: "Exporter", showInFolder: "Afficher dans le dossier", file: "Fichier", edit: "Éditer", view: "Affichage", window: "Fenêtre", quit: "Quitter", stopRecording: "Arrêter l'enregistrement", undo: "Annuler", redo: "Rétablir", cut: "Couper", copy: "Copier", paste: "Coller", selectAll: "Tout sélectionner", minimize: "Réduire", reload: "Recharger", forceReload: "Forcer le rechargement", toggleDevTools: "Afficher/masquer les outils de développement", actualSize: "Taille réelle", zoomIn: "Zoom avant", zoomOut: "Zoom arrière", toggleFullScreen: "Basculer en plein écran", recordingStatus: "Enregistrement : {{source}}", about: "À propos d’OpenScreen", services: "Services", hide: "Masquer OpenScreen", hideOthers: "Masquer les autres", unhide: "Tout afficher" }, Fo = { play: "Lecture", pause: "Pause", fullscreen: "Plein écran", exitFullscreen: "Quitter le plein écran" }, Do = { name: "Français", short: "FR" }, Ao = {
  actions: Co,
  playback: Fo,
  locale: Do
}, Oo = { triggerLabel: "Comment fonctionne la coupe", title: "Comment fonctionne la coupe", description: "Comprendre comment supprimer les parties indésirables de votre vidéo.", explanationBefore: "L'outil Coupe fonctionne en définissant les segments que vous souhaitez", remove: "supprimer", explanationMiddle: " — tout ce qui est", covered: "couvert", explanationAfter: "par un segment de coupe rouge sera coupé lors de l'export.", visualExample: "Exemple visuel", removed: "SUPPRIMÉ", kept: "Conservé", part1: "Partie 1", part2: "Partie 2", part3: "Partie 3", finalVideo: "Vidéo finale", step1Title: "1. Ajouter une coupe", step1DescriptionBefore: "Appuyez sur ", step1DescriptionAfter: " ou cliquez sur l'icône ciseaux pour marquer une section à supprimer.", step2Title: "2. Ajuster", step2Description: "Faites glisser les bords de la région rouge pour couvrir exactement ce que vous souhaitez couper." }, jo = { title: "Modifications non enregistrées", message: "Vous avez des modifications non enregistrées.", detail: "Voulez-vous enregistrer votre projet avant de fermer ?", saveAndClose: "Enregistrer et fermer", discardAndClose: "Ignorer et fermer", detailNewProject: "Voulez-vous enregistrer votre projet avant d'en créer un nouveau ?", saveAndNewProject: "Enregistrer et nouveau projet", discardAndNewProject: "Ignorer et nouveau projet", detailLoadProject: "Voulez-vous enregistrer votre projet avant d'en charger un autre ?", saveAndLoadProject: "Enregistrer et charger un projet", discardAndLoadProject: "Ignorer et charger un projet", loadProject: "Charger un projet…", saveProject: "Enregistrer le projet…", saveProjectAs: "Enregistrer le projet sous…", newProject: "Nouveau projet", importVideo: "Importer un fichier vidéo…" }, Io = { saveGif: "Enregistrer le GIF exporté", saveVideo: "Enregistrer la vidéo exportée", selectVideo: "Sélectionner un fichier vidéo", saveProject: "Enregistrer le projet OpenScreen", openProject: "Ouvrir un projet OpenScreen", gifImage: "Image GIF", mp4Video: "Vidéo MP4", videoFiles: "Fichiers vidéo", openscreenProject: "Projet OpenScreen", allFiles: "Tous les fichiers" }, _o = {
  export: { complete: "Export terminé", yourFormatReady: "Votre {{format}} est prêt", showInFolder: "Afficher dans le dossier", finalizingVideo: "Finalisation de l'export vidéo...", compilingGifProgress: "Compilation du GIF... {{progress}}%", compilingGifWait: "Compilation du GIF... Cela peut prendre un moment", takeMoment: "Cela peut prendre un moment...", failed: "Export échoué", tryAgain: "Veuillez réessayer", finalizingVideoTitle: "Finalisation de la vidéo", compilingGif: "Compilation du GIF", exportingFormat: "Export de {{format}}", compiling: "Compilation en cours", renderingFrames: "Rendu des images", processing: "Traitement en cours...", finalizing: "Finalisation...", compilingStatus: "Compilation...", status: "Statut", format: "Format", frames: "Images", cancelExport: "Annuler l'export", savedSuccessfully: "{{format}} enregistré avec succès !" },
  tutorial: Oo,
  unsavedChanges: jo,
  fileDialogs: Io
}, Eo = { cancel: "Annulla", save: "Salva", delete: "Elimina", close: "Chiudi", share: "Condividi", done: "Fatto", open: "Apri", upload: "Carica", export: "Esporta", showInFolder: "Mostra nella cartella", file: "File", edit: "Modifica", view: "Visualizza", window: "Finestra", quit: "Esci", stopRecording: "Interrompi registrazione", undo: "Annulla", redo: "Ripeti", cut: "Taglia", copy: "Copia", paste: "Incolla", selectAll: "Seleziona tutto", minimize: "Riduci a icona", reload: "Ricarica", forceReload: "Forza ricarica", toggleDevTools: "Attiva/disattiva strumenti sviluppatore", actualSize: "Dimensione effettiva", zoomIn: "Ingrandisci", zoomOut: "Riduci", toggleFullScreen: "Attiva/disattiva schermo intero", recordingStatus: "Registrazione: {{source}}", about: "Info su OpenScreen", services: "Servizi", hide: "Nascondi OpenScreen", hideOthers: "Nascondi gli altri", unhide: "Mostra tutto" }, Mo = { play: "Riproduci", pause: "Pausa", fullscreen: "Schermo intero", exitFullscreen: "Esci dallo schermo intero" }, ko = { name: "Italiano", short: "IT" }, Ro = {
  actions: Eo,
  playback: Mo,
  locale: ko
}, No = { triggerLabel: "Come funziona il taglio", title: "Come funziona il taglio", description: "Capire come eliminare le parti indesiderate del tuo video.", explanationBefore: "Lo strumento Taglia funziona definendo i segmenti che vuoi", remove: "rimuovere", explanationMiddle: " — tutto ciò", covered: "coperto", explanationAfter: "da un segmento rosso verrà eliminato durante l'esportazione.", visualExample: "Esempio visivo", removed: "RIMOSSO", kept: "Mantenuto", part1: "Parte 1", part2: "Parte 2", part3: "Parte 3", finalVideo: "Video finale", step1Title: "1. Aggiungi taglio", step1DescriptionBefore: "Premi ", step1DescriptionAfter: " o clicca sull'icona delle forbici per contrassegnare una sezione da rimuovere.", step2Title: "2. Regolazione", step2Description: "Trascina i bordi della regione rossa per coprire esattamente ciò che vuoi eliminare." }, Vo = { title: "Modifiche non salvate", message: "Hai delle modifiche non salvate.", detail: "Vuoi salvare il progetto prima di chiudere?", saveAndClose: "Salva e chiudi", discardAndClose: "Scarta e chiudi", loadProject: "Carica progetto…", saveProject: "Salva progetto…", saveProjectAs: "Salva progetto come…", newProject: "Nuovo progetto", importVideo: "Importa file video…", detailNewProject: "Vuoi salvare il progetto prima di crearne uno nuovo?", saveAndNewProject: "Salva e crea nuovo progetto", discardAndNewProject: "Scarta e crea nuovo progetto", detailLoadProject: "Vuoi salvare il progetto prima di caricarne un altro?", saveAndLoadProject: "Salva e carica progetto", discardAndLoadProject: "Scarta e carica progetto" }, Bo = { saveGif: "Salva GIF esportata", saveVideo: "Salva video esportato", selectVideo: "Seleziona file video", saveProject: "Salva progetto OpenScreen", openProject: "Apri progetto OpenScreen", gifImage: "Immagine GIF", mp4Video: "Video MP4", videoFiles: "File video", openscreenProject: "Progetto OpenScreen", allFiles: "Tutti i file" }, zo = {
  export: { complete: "Esportazione completata", yourFormatReady: "Il tuo {{format}} è pronto", showInFolder: "Mostra nella cartella", finalizingVideo: "Finalizzazione esportazione video...", compilingGifProgress: "Compilazione GIF... {{progress}}%", compilingGifWait: "Compilazione GIF... Potrebbe richiedere del tempo", takeMoment: "Ci potrebbe impiegare un momento...", failed: "Esportazione fallita", tryAgain: "Riprova", finalizingVideoTitle: "Finalizzazione video", compilingGif: "Compilazione GIF", exportingFormat: "Esportazione {{format}}", compiling: "Compilazione", renderingFrames: "Rendering fotogrammi", processing: "Elaborazione...", finalizing: "Finalizzazione...", compilingStatus: "Compilazione...", status: "Stato", format: "Formato", frames: "Fotogrammi", cancelExport: "Annulla esportazione", savedSuccessfully: "{{format}} salvato con successo!" },
  tutorial: No,
  unsavedChanges: Vo,
  fileDialogs: Bo
}, Uo = { cancel: "キャンセル", save: "保存", delete: "削除", close: "閉じる", share: "共有", done: "完了", open: "開く", upload: "読み込む", export: "エクスポート", showInFolder: "フォルダに表示", file: "ファイル", edit: "編集", view: "表示", window: "ウィンドウ", quit: "終了", stopRecording: "録画を停止", undo: "元に戻す", redo: "やり直す", cut: "切り取り", copy: "コピー", paste: "貼り付け", selectAll: "すべて選択", minimize: "最小化", reload: "再読み込み", forceReload: "強制再読み込み", toggleDevTools: "開発者ツールを切り替え", actualSize: "実際のサイズ", zoomIn: "拡大", zoomOut: "縮小", toggleFullScreen: "フルスクリーンを切り替え", recordingStatus: "録画中: {{source}}", about: "OpenScreenについて", services: "サービス", hide: "OpenScreenを隠す", hideOthers: "ほかを隠す", unhide: "すべて表示" }, Wo = { play: "再生", pause: "一時停止", fullscreen: "全画面表示", exitFullscreen: "全画面表示を終了" }, Lo = { name: "日本語", short: "JA" }, $o = {
  actions: Uo,
  playback: Wo,
  locale: Lo
}, Go = { triggerLabel: "トリミングの仕組み", title: "トリミングの仕組み", description: "動画の不要な部分を削除する方法について解説します。", explanationBefore: "トリムツールは、動画から", remove: "「削除したい部分」", explanationMiddle: "を指定することで機能します。エクスポート時には、赤い枠で", covered: "囲まれた部分", explanationAfter: "がすべてカットされます。", visualExample: "視覚的な例", removed: "削除", kept: "保持", part1: "パート 1", part2: "パート 2", part3: "パート 3", finalVideo: "完成動画", step1Title: "1. 削除範囲を追加", step1DescriptionBefore: "キーボードの", step1DescriptionAfter: "、またはハサミのアイコンをクリックして、削除したい範囲を指定します。", step2Title: "2. 範囲を調整", step2Description: "赤い領域の両端をドラッグして、削除したい範囲を正確に調整します。" }, Ho = { title: "未保存の変更", message: "未保存の変更があります。", detail: "閉じる前にプロジェクトを保存しますか？", saveAndClose: "保存して閉じる", discardAndClose: "破棄して閉じる", detailNewProject: "新しいプロジェクトを作成する前に保存しますか？", saveAndNewProject: "保存して新規プロジェクト", discardAndNewProject: "破棄して新規プロジェクト", detailLoadProject: "別のプロジェクトを読み込む前にプロジェクトを保存しますか？", saveAndLoadProject: "保存してプロジェクトを読み込む", discardAndLoadProject: "破棄してプロジェクトを読み込む", loadProject: "プロジェクトを読み込む…", saveProject: "プロジェクトを保存…", saveProjectAs: "プロジェクトを名前を付けて保存…", newProject: "新規プロジェクト", importVideo: "動画ファイルを読み込む…" }, Ko = { saveGif: "エクスポートしたGIFを保存", saveVideo: "エクスポートした動画を保存", selectVideo: "動画ファイルを選択", saveProject: "OpenScreen プロジェクトを保存", openProject: "OpenScreen プロジェクトを開く", gifImage: "GIF 画像", mp4Video: "MP4 動画", videoFiles: "動画ファイル", openscreenProject: "OpenScreen プロジェクト", allFiles: "すべてのファイル" }, Yo = {
  export: { complete: "エクスポート完了", yourFormatReady: "{{format}}の準備ができました", showInFolder: "フォルダで表示", finalizingVideo: "動画のエクスポートを仕上げています...", compilingGifProgress: "GIFを生成中... {{progress}}%", compilingGifWait: "GIFを生成中... しばらくお待ちください", takeMoment: "少々お待ちください...", failed: "エクスポートに失敗しました", tryAgain: "もう一度お試しください", finalizingVideoTitle: "動画の仕上げ", compilingGif: "GIFを生成中", exportingFormat: "{{format}}をエクスポート中", compiling: "生成中", renderingFrames: "フレームをレンダリング中", processing: "処理中...", finalizing: "最終処理中...", compilingStatus: "生成中...", status: "ステータス", format: "フォーマット", frames: "フレーム", cancelExport: "エクスポートをキャンセル", savedSuccessfully: "{{format}}を正常に保存しました！" },
  tutorial: Go,
  unsavedChanges: Ho,
  fileDialogs: Ko
}, Jo = { cancel: "취소", save: "저장", delete: "삭제", close: "닫기", share: "공유", done: "완료", open: "열기", upload: "업로드", export: "내보내기", showInFolder: "폴더에 표시", file: "파일", edit: "편집", view: "보기", window: "창", quit: "종료", stopRecording: "녹화 중지", undo: "실행 취소", redo: "다시 실행", cut: "잘라내기", copy: "복사", paste: "붙여넣기", selectAll: "모두 선택", minimize: "최소화", reload: "새로고침", forceReload: "강제 새로고침", toggleDevTools: "개발자 도구 전환", actualSize: "실제 크기", zoomIn: "확대", zoomOut: "축소", toggleFullScreen: "전체 화면 전환", recordingStatus: "녹화 중: {{source}}", about: "OpenScreen 정보", services: "서비스", hide: "OpenScreen 숨기기", hideOthers: "다른 항목 숨기기", unhide: "모두 보기" }, Xo = { play: "재생", pause: "일시정지", fullscreen: "전체화면", exitFullscreen: "전체화면 종료" }, qo = { name: "한국어", short: "KO" }, Zo = {
  actions: Jo,
  playback: Xo,
  locale: qo
}, Qo = { triggerLabel: "트리밍 사용법", title: "트리밍 사용법", description: "비디오에서 불필요한 부분을 잘라내는 방법을 알아보세요.", explanationBefore: "트림 도구는 제거할 구간을", remove: "지정", explanationMiddle: "하는 방식으로 동작합니다 —", covered: "빨간 트림 구간으로 덮인", explanationAfter: "부분은 내보낼 때 잘려나갑니다.", visualExample: "화면 예시", removed: "제거됨", kept: "유지됨", part1: "파트 1", part2: "파트 2", part3: "파트 3", finalVideo: "최종 비디오", step1Title: "1. 트림 추가", step1DescriptionBefore: "", step1DescriptionAfter: "키를 누르거나 가위 아이콘을 클릭해 제거할 구간을 표시하세요.", step2Title: "2. 조정", step2Description: "빨간 구간의 가장자리를 드래그해 잘라낼 범위를 설정하세요." }, ea = { title: "저장되지 않은 변경 사항", message: "저장되지 않은 변경 사항이 있습니다.", detail: "닫기 전에 프로젝트를 저장하시겠습니까?", saveAndClose: "저장 후 닫기", discardAndClose: "저장하지 않고 닫기", detailNewProject: "새 프로젝트를 만들기 전에 저장하시겠습니까?", saveAndNewProject: "저장 후 새 프로젝트", discardAndNewProject: "저장하지 않고 새 프로젝트", detailLoadProject: "다른 프로젝트를 불러오기 전에 저장하시겠습니까?", saveAndLoadProject: "저장 후 프로젝트 불러오기", discardAndLoadProject: "저장하지 않고 프로젝트 불러오기", loadProject: "프로젝트 불러오기...", saveProject: "프로젝트 저장...", saveProjectAs: "다른 이름으로 프로젝트 저장...", newProject: "새 프로젝트", importVideo: "비디오 파일 가져오기…" }, ta = { saveGif: "내보낸 GIF 저장", saveVideo: "내보낸 비디오 저장", selectVideo: "비디오 파일 선택", saveProject: "OpenScreen 프로젝트 저장", openProject: "OpenScreen 프로젝트 열기", gifImage: "GIF 이미지", mp4Video: "MP4 비디오", videoFiles: "비디오 파일", openscreenProject: "OpenScreen 프로젝트", allFiles: "모든 파일" }, ra = {
  export: { complete: "내보내기 완료", yourFormatReady: "{{format}} 파일이 준비되었습니다", showInFolder: "폴더에서 보기", finalizingVideo: "비디오 내보내기 마무리 중...", compilingGifProgress: "GIF 생성 중... {{progress}}%", compilingGifWait: "GIF 생성 중... 잠시 시간이 걸릴 수 있습니다", takeMoment: "잠시 기다려 주세요...", failed: "내보내기 실패", tryAgain: "다시 시도해 주세요", finalizingVideoTitle: "비디오 마무리 중", compilingGif: "GIF 생성 중", exportingFormat: "{{format}} 내보내는 중", compiling: "생성 중...", renderingFrames: "프레임 렌더링 중", processing: "처리 중...", finalizing: "마무리 중...", compilingStatus: "생성 중...", status: "상태", format: "형식", frames: "프레임", cancelExport: "내보내기 취소", savedSuccessfully: "{{format}} 저장이 완료되었습니다!" },
  tutorial: Qo,
  unsavedChanges: ea,
  fileDialogs: ta
}, na = { cancel: "Отмена", save: "Сохранить", delete: "Удалить", close: "Закрыть", share: "Поделиться", done: "Готово", open: "Открыть", upload: "Загрузить", export: "Экспорт", showInFolder: "Показать в папке", file: "Файл", edit: "Редактировать", view: "Вид", window: "Окно", quit: "Выход", stopRecording: "Остановить запись", undo: "Отменить", redo: "Повторить", cut: "Вырезать", copy: "Копировать", paste: "Вставить", selectAll: "Выделить всё", minimize: "Свернуть", reload: "Перезагрузить", forceReload: "Принудительная перезагрузка", toggleDevTools: "Переключить инструменты разработчика", actualSize: "Реальный размер", zoomIn: "Увеличить", zoomOut: "Уменьшить", toggleFullScreen: "Полноэкранный режим", recordingStatus: "Запись: {{source}}", about: "О OpenScreen", services: "Сервисы", hide: "Скрыть OpenScreen", hideOthers: "Скрыть остальные", unhide: "Показать все" }, oa = { play: "Воспроизвести", pause: "Пауза", fullscreen: "Полный экран", exitFullscreen: "Выход из полного экрана" }, aa = { name: "Русский", short: "RU" }, sa = {
  actions: na,
  playback: oa,
  locale: aa
}, ia = { triggerLabel: "Как работает обрезка", title: "Как работает обрезка", description: "Как вырезать ненужные части видео.", explanationBefore: "Инструмент обрезки работает путём определения сегментов, которые вы хотите", remove: "удалить", explanationMiddle: " — всё, что", covered: "покрыто", explanationAfter: "красным сегментом обрезки, будет вырезано при экспорте.", visualExample: "Визуальный пример", removed: "УДАЛЕНО", kept: "Сохранено", part1: "Часть 1", part2: "Часть 2", part3: "Часть 3", finalVideo: "Итоговое видео", step1Title: "1. Добавить обрезку", step1DescriptionBefore: "Нажмите ", step1DescriptionAfter: " или нажмите на значок ножниц, чтобы отметить секцию для удаления.", step2Title: "2. Настроить", step2Description: "Перетащите края красной области, чтобы точно покрыть то, что вы хотите вырезать." }, ca = { title: "Несохранённые изменения", message: "У вас есть несохранённые изменения.", detail: "Хотите сохранить проект перед закрытием?", saveAndClose: "Сохранить и закрыть", discardAndClose: "Отменить и закрыть", detailNewProject: "Хотите сохранить проект перед созданием нового?", saveAndNewProject: "Сохранить и новый проект", discardAndNewProject: "Отменить и новый проект", detailLoadProject: "Хотите сохранить проект перед загрузкой другого?", saveAndLoadProject: "Сохранить и загрузить проект", discardAndLoadProject: "Отменить и загрузить проект", loadProject: "Загрузить проект…", saveProject: "Сохранить проект…", saveProjectAs: "Сохранить проект как…", newProject: "Новый проект", importVideo: "Импортировать видеофайл…" }, la = { saveGif: "Сохранить экспортированный GIF", saveVideo: "Сохранить экспортированное видео", selectVideo: "Выбрать видеофайл", saveProject: "Сохранить проект OpenScreen", openProject: "Открыть проект OpenScreen", gifImage: "GIF изображение", mp4Video: "MP4 видео", videoFiles: "Видеофайлы", openscreenProject: "Проект OpenScreen", allFiles: "Все файлы" }, ua = {
  export: { complete: "Экспорт завершён", yourFormatReady: "Ваш {{format}} готов", showInFolder: "Показать в папке", finalizingVideo: "Завершение экспорта видео...", compilingGifProgress: "Сборка GIF... {{progress}}%", compilingGifWait: "Сборка GIF... Это может занять некоторое время", takeMoment: "Это может занять некоторое время...", failed: "Экспорт не удался", tryAgain: "Пожалуйста, попробуйте снова", finalizingVideoTitle: "Завершение видео", compilingGif: "Сборка GIF", exportingFormat: "Экспорт {{format}}", compiling: "Сборка", renderingFrames: "Рендеринг кадров", processing: "Обработка...", finalizing: "Завершение...", compilingStatus: "Сборка...", status: "Статус", format: "Формат", frames: "Кадры", cancelExport: "Отменить экспорт", savedSuccessfully: "{{format}} успешно сохранён!" },
  tutorial: ia,
  unsavedChanges: ca,
  fileDialogs: la
}, da = { cancel: "İptal", save: "Kaydet", delete: "Sil", close: "Kapat", share: "Paylaş", done: "Tamam", open: "Aç", upload: "Yükle", export: "Dışa Aktar", showInFolder: "Klasörde Göster", file: "Dosya", edit: "Düzenle", view: "Görünüm", window: "Pencere", quit: "Çıkış", stopRecording: "Kaydı Durdur", undo: "Geri Al", redo: "Yinele", cut: "Kes", copy: "Kopyala", paste: "Yapıştır", selectAll: "Tümünü Seç", minimize: "Simge Durumuna Küçült", reload: "Yeniden Yükle", forceReload: "Zorla Yeniden Yükle", toggleDevTools: "Geliştirici Araçlarını Aç/Kapat", actualSize: "Gerçek Boyut", zoomIn: "Yakınlaştır", zoomOut: "Uzaklaştır", toggleFullScreen: "Tam Ekranı Aç/Kapat", recordingStatus: "Kaydediliyor: {{source}}", about: "OpenScreen Hakkında", services: "Servisler", hide: "OpenScreen’i Gizle", hideOthers: "Diğerlerini Gizle", unhide: "Tümünü Göster" }, pa = { play: "Oynat", pause: "Duraklat", fullscreen: "Tam Ekran", exitFullscreen: "Tam Ekrandan Çık" }, ma = { name: "Türkçe", short: "TR" }, fa = {
  actions: da,
  playback: pa,
  locale: ma
}, ha = { triggerLabel: "Kırpma nasıl çalışır", title: "Kırpma Nasıl Çalışır", description: "Videonuzun istenmeyen bölümlerini nasıl keseceğinizi anlayın.", explanationBefore: "Kırpma aracı, istediğiniz bölümleri", remove: "kaldırmak", explanationMiddle: " için kullanılır; kırmızı kırpma bölgesiyle", covered: "kaplanan", explanationAfter: "her şey dışa aktarımda kesilecektir.", visualExample: "Görsel Örnek", removed: "KALDIRILDI", kept: "Korundu", part1: "Bölüm 1", part2: "Bölüm 2", part3: "Bölüm 3", finalVideo: "Son Video", step1Title: "1. Kırpma Ekle", step1DescriptionBefore: "Kaldırılacak bölümü işaretlemek için ", step1DescriptionAfter: " tuşuna basın veya makas simgesine tıklayın.", step2Title: "2. Ayarla", step2Description: "Kesmek istediğiniz kısmı tam olarak kaplamak için kırmızı bölgenin kenarlarını sürükleyin." }, ya = { title: "Kaydedilmemiş Değişiklikler", message: "Kaydedilmemiş değişiklikleriniz var.", detail: "Kapatmadan önce projenizi kaydetmek ister misiniz?", saveAndClose: "Kaydet ve Kapat", discardAndClose: "Kaydetmeden Kapat", detailNewProject: "Yeni proje oluşturmadan önce kaydetmek ister misiniz?", saveAndNewProject: "Kaydet ve Yeni Proje", discardAndNewProject: "Kaydetmeden Yeni Proje", detailLoadProject: "Başka bir proje yüklemeden önce kaydetmek ister misiniz?", saveAndLoadProject: "Kaydet ve Proje Yükle", discardAndLoadProject: "Kaydetmeden Proje Yükle", loadProject: "Proje Yükle…", saveProject: "Proje Kaydet…", saveProjectAs: "Farklı Kaydet…", newProject: "Yeni proje", importVideo: "Video dosyası içe aktar…" }, ga = { saveGif: "Dışa Aktarılan GIF'i Kaydet", saveVideo: "Dışa Aktarılan Videoyu Kaydet", selectVideo: "Video Dosyası Seç", saveProject: "OpenScreen Projesini Kaydet", openProject: "OpenScreen Projesini Aç", gifImage: "GIF Görüntüsü", mp4Video: "MP4 Video", videoFiles: "Video Dosyaları", openscreenProject: "OpenScreen Projesi", allFiles: "Tüm Dosyalar" }, wa = {
  export: { complete: "Dışa Aktarım Tamamlandı", yourFormatReady: "{{format}} dosyanız hazır", showInFolder: "Klasörde Göster", finalizingVideo: "Video dışa aktarımı sonlandırılıyor...", compilingGifProgress: "GIF derleniyor... %{{progress}}", compilingGifWait: "GIF derleniyor... Bu biraz zaman alabilir", takeMoment: "Bu biraz zaman alabilir...", failed: "Dışa Aktarım Başarısız", tryAgain: "Lütfen tekrar deneyin", finalizingVideoTitle: "Video Sonlandırılıyor", compilingGif: "GIF Derleniyor", exportingFormat: "{{format}} Dışa Aktarılıyor", compiling: "Derleniyor", renderingFrames: "Kareler İşleniyor", processing: "İşleniyor...", finalizing: "Sonlandırılıyor...", compilingStatus: "Derleniyor...", status: "Durum", format: "Biçim", frames: "Kareler", cancelExport: "Dışa Aktarımı İptal Et", savedSuccessfully: "{{format}} başarıyla kaydedildi!" },
  tutorial: ha,
  unsavedChanges: ya,
  fileDialogs: ga
}, va = { cancel: "Hủy", save: "Lưu", delete: "Xóa", close: "Đóng", share: "Chia sẻ", done: "Hoàn tất", open: "Mở", upload: "Tải lên", export: "Xuất", showInFolder: "Hiển thị trong thư mục", file: "Tệp", edit: "Chỉnh sửa", view: "Xem", window: "Cửa sổ", quit: "Thoát", stopRecording: "Dừng ghi hình", undo: "Hoàn tác", redo: "Làm lại", cut: "Cắt", copy: "Sao chép", paste: "Dán", selectAll: "Chọn tất cả", minimize: "Thu nhỏ", reload: "Tải lại", forceReload: "Buộc tải lại", toggleDevTools: "Bật/tắt công cụ nhà phát triển", actualSize: "Kích thước thực", zoomIn: "Phóng to", zoomOut: "Thu nhỏ", toggleFullScreen: "Bật/tắt toàn màn hình", recordingStatus: "Đang ghi: {{source}}", about: "Giới thiệu OpenScreen", services: "Dịch vụ", hide: "Ẩn OpenScreen", hideOthers: "Ẩn ứng dụng khác", unhide: "Hiển thị tất cả" }, Sa = { play: "Phát", pause: "Tạm dừng", fullscreen: "Toàn màn hình", exitFullscreen: "Thoát toàn màn hình" }, ba = { name: "Tiếng Việt", short: "VI" }, Pa = {
  actions: va,
  playback: Sa,
  locale: ba
}, Ta = { triggerLabel: "Cách hoạt động của công cụ cắt", title: "Cách cắt video", description: "Hiểu cách cắt bỏ các phần không mong muốn trong video của bạn.", explanationBefore: "Công cụ Cắt hoạt động bằng cách xác định các đoạn bạn muốn", remove: "xóa", explanationMiddle: " — bất cứ thứ gì", covered: "được bao phủ", explanationAfter: "bởi một đoạn cắt màu đỏ sẽ bị loại bỏ khi bạn xuất.", visualExample: "Ví dụ trực quan", removed: "ĐÃ XÓA", kept: "Giữ lại", part1: "Phần 1", part2: "Phần 2", part3: "Phần 3", finalVideo: "Video cuối cùng", step1Title: "1. Thêm đoạn cắt", step1DescriptionBefore: "Nhấn ", step1DescriptionAfter: " hoặc nhấp vào biểu tượng cái kéo để đánh dấu một phần cần xóa.", step2Title: "2. Điều chỉnh", step2Description: "Kéo các cạnh của vùng màu đỏ để bao phủ chính xác những gì bạn muốn cắt bỏ." }, xa = { title: "Thay đổi chưa được lưu", message: "Bạn có các thay đổi chưa được lưu.", detail: "Bạn có muốn lưu dự án của mình trước khi đóng không?", saveAndClose: "Lưu & Đóng", discardAndClose: "Bỏ qua & Đóng", detailNewProject: "Bạn có muốn lưu dự án trước khi tạo dự án mới không?", saveAndNewProject: "Lưu & Dự án mới", discardAndNewProject: "Bỏ qua & Dự án mới", detailLoadProject: "Bạn có muốn lưu dự án của mình trước khi tải dự án khác không?", saveAndLoadProject: "Lưu & Tải dự án", discardAndLoadProject: "Bỏ qua & Tải dự án", loadProject: "Tải dự án…", saveProject: "Lưu dự án…", saveProjectAs: "Lưu dự án thành…", newProject: "Dự án mới", importVideo: "Nhập tệp video…" }, Ca = { saveGif: "Lưu GIF đã xuất", saveVideo: "Lưu Video đã xuất", selectVideo: "Chọn tệp video", saveProject: "Lưu dự án OpenScreen", openProject: "Mở dự án OpenScreen", gifImage: "Hình ảnh GIF", mp4Video: "Video MP4", videoFiles: "Tệp Video", openscreenProject: "Dự án OpenScreen", allFiles: "Tất cả các tệp" }, Fa = {
  export: { complete: "Xuất hoàn tất", yourFormatReady: "{{format}} của bạn đã sẵn sàng", showInFolder: "Hiển thị trong thư mục", finalizingVideo: "Đang hoàn tất xuất video...", compilingGifProgress: "Đang biên dịch GIF... {{progress}}%", compilingGifWait: "Đang biên dịch GIF... Có thể mất một lúc", takeMoment: "Có thể mất một chút thời gian...", failed: "Xuất thất bại", tryAgain: "Vui lòng thử lại", finalizingVideoTitle: "Hoàn tất video", compilingGif: "Biên dịch GIF", exportingFormat: "Đang xuất {{format}}", compiling: "Đang biên dịch", renderingFrames: "Kết xuất khung hình", processing: "Đang xử lý...", finalizing: "Đang hoàn tất...", compilingStatus: "Đang biên dịch...", status: "Trạng thái", format: "Định dạng", frames: "Khung hình", cancelExport: "Hủy xuất", savedSuccessfully: "Đã lưu {{format}} thành công!" },
  tutorial: Ta,
  unsavedChanges: xa,
  fileDialogs: Ca
}, Da = { cancel: "取消", save: "保存", delete: "删除", close: "关闭", share: "分享", done: "完成", open: "打开", upload: "上传", export: "导出", showInFolder: "在文件夹中显示", file: "文件", edit: "编辑", view: "视图", window: "窗口", quit: "退出", stopRecording: "停止录制", undo: "撤销", redo: "重做", cut: "剪切", copy: "复制", paste: "粘贴", selectAll: "全选", minimize: "最小化", reload: "重新加载", forceReload: "强制重新加载", toggleDevTools: "切换开发者工具", actualSize: "实际大小", zoomIn: "放大", zoomOut: "缩小", toggleFullScreen: "切换全屏", recordingStatus: "正在录制：{{source}}", about: "关于 OpenScreen", services: "服务", hide: "隐藏 OpenScreen", hideOthers: "隐藏其他", unhide: "显示全部" }, Aa = { play: "播放", pause: "暂停", fullscreen: "全屏", exitFullscreen: "退出全屏" }, Oa = { name: "简体中文", short: "简中" }, ja = {
  actions: Da,
  playback: Aa,
  locale: Oa
}, Ia = { triggerLabel: "剪辑功能说明", title: "剪辑功能说明", description: "了解如何剪掉视频中不需要的部分。", explanationBefore: "剪辑工具通过定义您要", remove: "移除", explanationMiddle: "——任何被", covered: "覆盖", explanationAfter: "的红色剪辑区域部分将在导出时被剪掉。", visualExample: "示例演示", removed: "已移除", kept: "保留", part1: "第 1 部分", part2: "第 2 部分", part3: "第 3 部分", finalVideo: "最终视频", step1Title: "1. 添加剪辑", step1DescriptionBefore: "按", step1DescriptionAfter: "键或点击剪刀图标来标记要移除的片段。", step2Title: "2. 调整", step2Description: "拖动红色区域的边缘，精确覆盖您要剪掉的部分。" }, _a = { title: "未保存的更改", message: "您有未保存的更改。", detail: "是否在关闭前保存项目？", saveAndClose: "保存并关闭", discardAndClose: "放弃并关闭", detailNewProject: "是否在创建新项目前保存当前项目？", saveAndNewProject: "保存并新建项目", discardAndNewProject: "放弃并新建项目", detailLoadProject: "是否在加载其他项目前保存当前项目？", saveAndLoadProject: "保存并加载项目", discardAndLoadProject: "放弃并加载项目", loadProject: "加载项目…", saveProject: "保存项目…", saveProjectAs: "项目另存为…", newProject: "新建项目", importVideo: "导入视频文件…" }, Ea = { saveGif: "保存导出的 GIF", saveVideo: "保存导出的视频", selectVideo: "选择视频文件", saveProject: "保存 OpenScreen 项目", openProject: "打开 OpenScreen 项目", gifImage: "GIF 图片", mp4Video: "MP4 视频", videoFiles: "视频文件", openscreenProject: "OpenScreen 项目", allFiles: "所有文件" }, Ma = {
  export: { complete: "导出完成", yourFormatReady: "您的 {{format}} 已准备就绪", showInFolder: "在文件夹中显示", finalizingVideo: "正在完成视频导出...", compilingGifProgress: "正在编译 GIF... {{progress}}%", compilingGifWait: "正在编译 GIF... 这可能需要一些时间", takeMoment: "这可能需要一点时间...", failed: "导出失败", tryAgain: "请重试", finalizingVideoTitle: "正在完成视频", compilingGif: "正在编译 GIF", exportingFormat: "正在导出 {{format}}", compiling: "编译中", renderingFrames: "渲染帧", processing: "处理中...", finalizing: "正在完成...", compilingStatus: "编译中...", status: "状态", format: "格式", frames: "帧", cancelExport: "取消导出", savedSuccessfully: "{{format}} 保存成功！" },
  tutorial: Ia,
  unsavedChanges: _a,
  fileDialogs: Ea
}, ka = { cancel: "取消", save: "儲存", delete: "刪除", close: "關閉", share: "分享", done: "完成", open: "開啟", upload: "上傳", export: "匯出", showInFolder: "在資料夾中顯示", file: "檔案", edit: "編輯", view: "檢視", window: "視窗", quit: "退出", stopRecording: "停止錄製", undo: "復原", redo: "重做", cut: "剪下", copy: "複製", paste: "貼上", selectAll: "全選", minimize: "最小化", reload: "重新載入", forceReload: "強制重新載入", toggleDevTools: "切換開發者工具", actualSize: "實際大小", zoomIn: "放大", zoomOut: "縮小", toggleFullScreen: "切換全螢幕", recordingStatus: "錄製中：{{source}}", about: "關於 OpenScreen", services: "服務", hide: "隱藏 OpenScreen", hideOthers: "隱藏其他", unhide: "全部顯示" }, Ra = { play: "播放", pause: "暫停", fullscreen: "全螢幕", exitFullscreen: "退出全螢幕" }, Na = { name: "繁體中文", short: "繁中" }, Va = {
  actions: ka,
  playback: Ra,
  locale: Na
}, Ba = { triggerLabel: "剪輯功能說明", title: "剪輯功能說明", description: "了解如何剪掉影片中不需要的部分。", explanationBefore: "剪輯工具透過定義您要", remove: "移除", explanationMiddle: "——任何被", covered: "覆蓋", explanationAfter: "的紅色剪輯區域部分將在匯出時被剪掉。", visualExample: "示例演示", removed: "已移除", kept: "保留", part1: "第 1 部分", part2: "第 2 部分", part3: "第 3 部分", finalVideo: "最終影片", step1Title: "1. 添加剪輯", step1DescriptionBefore: "按", step1DescriptionAfter: "鍵或點擊剪刀圖示來標記要移除的片段。", step2Title: "2. 調整", step2Description: "拖動紅色區域的邊緣，精確覆蓋您要剪掉的部分。" }, za = { title: "未儲存的變更", message: "您有未儲存的變更。", detail: "是否在關閉前儲存專案？", saveAndClose: "儲存並關閉", discardAndClose: "捨棄並關閉", detailNewProject: "是否在建立新專案前儲存目前的專案？", saveAndNewProject: "儲存並建立新專案", discardAndNewProject: "捨棄並建立新專案", detailLoadProject: "是否在載入其他專案前儲存目前的專案？", saveAndLoadProject: "儲存並載入專案", discardAndLoadProject: "捨棄並載入專案", loadProject: "載入專案…", saveProject: "儲存專案…", saveProjectAs: "專案另存新檔…", newProject: "新增專案", importVideo: "匯入影片檔…" }, Ua = { saveGif: "儲存匯出的 GIF", saveVideo: "儲存匯出的影片", selectVideo: "選擇影片檔案", saveProject: "儲存 OpenScreen 專案", openProject: "開啟 OpenScreen 專案", gifImage: "GIF 圖片", mp4Video: "MP4 影片", videoFiles: "影片檔案", openscreenProject: "OpenScreen 專案", allFiles: "所有檔案" }, Wa = {
  export: { complete: "匯出完成", yourFormatReady: "您的 {{format}} 已準備就緒", showInFolder: "在資料夾中顯示", finalizingVideo: "正在完成影片匯出...", compilingGifProgress: "正在編譯 GIF... {{progress}}%", compilingGifWait: "正在編譯 GIF... 這可能需要一些時間", takeMoment: "這可能需要一點時間...", failed: "匯出失敗", tryAgain: "請重試", finalizingVideoTitle: "正在完成影片", compilingGif: "正在編譯 GIF", exportingFormat: "正在匯出 {{format}}", compiling: "編譯中", renderingFrames: "渲染影格", processing: "處理中...", finalizing: "正在完成...", compilingStatus: "編譯中...", status: "狀態", format: "格式", frames: "影格", cancelExport: "取消匯出", savedSuccessfully: "{{format}} 儲存成功！" },
  tutorial: Ba,
  unsavedChanges: za,
  fileDialogs: Ua
}, xr = {
  en: { common: po, dialogs: yo },
  ar: { common: no, dialogs: io },
  es: { common: So, dialogs: xo },
  fr: { common: Ao, dialogs: _o },
  it: { common: Ro, dialogs: zo },
  "ja-JP": { common: $o, dialogs: Yo },
  "ko-KR": { common: Zo, dialogs: ra },
  ru: { common: sa, dialogs: ua },
  tr: { common: fa, dialogs: wa },
  vi: { common: Pa, dialogs: Fa },
  "zh-CN": { common: ja, dialogs: Ma },
  "zh-TW": { common: Va, dialogs: Wa }
};
let pn = "en";
function La(e) {
  (e === "en" || e === "ar" || e === "es" || e === "fr" || e === "it" || e === "ja-JP" || e === "ko-KR" || e === "ru" || e === "tr" || e === "vi" || e === "zh-CN" || e === "zh-TW") && (pn = e);
}
function Cr(e, t) {
  const r = t.split(".");
  let n = e;
  for (const a of r) {
    if (n == null || typeof n != "object") return;
    n = n[a];
  }
  return typeof n == "string" ? n : void 0;
}
function $a(e, t) {
  return t ? e.replace(/\{\{(\w+)\}\}/g, (r, n) => String(t[n] ?? `{{${n}}}`)) : e;
}
function _(e, t, r) {
  const n = Cr(xr[pn]?.[e], t) ?? Cr(xr.en?.[e], t);
  return n == null ? `${e}.${t}` : $a(n, r);
}
const Gt = "openscreen-macos-cursor-helper", mn = 5e3;
function Ga() {
  const e = process.env.OPENSCREEN_MAC_CURSOR_HELPER_EXE?.trim(), t = process.env.APP_ROOT ? S.resolve(process.env.APP_ROOT) : process.cwd(), r = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64", n = typeof process.resourcesPath == "string" ? process.resourcesPath : S.join(t, "resources");
  return [
    e,
    S.join(t, "electron", "native", "screencapturekit", "build", Gt),
    S.join(t, "electron", "native", "bin", r, Gt),
    S.join(n, "electron", "native", "bin", r, Gt)
  ].filter((a) => !!a);
}
function fn() {
  for (const e of Ga())
    try {
      return $n(e, gt.X_OK), e;
    } catch {
    }
  return null;
}
async function Ha() {
  if (process.platform !== "darwin")
    return { success: !0, granted: !0, status: "granted" };
  const e = fn();
  return e ? new Promise(
    (t) => {
      const r = Ve(e, [JSON.stringify({ sampleIntervalMs: 250 })], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let n = !1, a = "";
      const s = (m) => {
        n || (n = !0, clearTimeout(p), r.killed || r.kill("SIGTERM"), t(m));
      }, p = setTimeout(() => {
        s({
          success: !1,
          granted: !1,
          status: "timeout",
          error: "Timed out waiting for macOS cursor helper"
        });
      }, mn);
      r.stdout.setEncoding("utf8"), r.stdout.on("data", (m) => {
        a += m;
        const f = a.split(/\r?\n/);
        a = f.pop() ?? "";
        for (const b of f) {
          const F = b.trim();
          if (F)
            try {
              const k = JSON.parse(F);
              if (k.type === "ready") {
                s({
                  success: !0,
                  granted: k.accessibilityTrusted === !0,
                  status: k.accessibilityTrusted === !0 ? "granted" : "not-determined"
                });
                return;
              }
            } catch {
            }
        }
      }), r.once("error", (m) => {
        s({
          success: !1,
          granted: !1,
          status: "error",
          error: m.message
        });
      }), r.once("exit", (m, f) => {
        s({
          success: !1,
          granted: !1,
          status: "exited",
          error: `macOS cursor helper exited before ready (code=${m}, signal=${f})`
        });
      });
    }
  ) : { success: !0, granted: !1, status: "missing-helper" };
}
function Fr(e, t, r) {
  return Math.min(r, Math.max(t, e));
}
function Ka(e) {
  return e === "arrow" || e === "pointer" || e === "text" ? e : null;
}
class yr {
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
    this.samples = [], this.assets.clear(), this.lineBuffer = "", this.startTimeMs = this.options.startTimeMs ?? Date.now(), this.previousLeftButtonDown = !1, this.consecutiveOutsideSamples = 0;
    const t = fn();
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
    const r = G.getCursorScreenPoint(), n = G.getDisplayNearestPoint(r).scaleFactor;
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
        } catch (s) {
          console.error("Failed to parse macOS cursor helper output:", s, a);
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
      Ka(t.cursorType),
      t.assetId ?? null,
      t.leftButtonDown === !0,
      t.leftButtonPressed === !0,
      t.leftButtonReleased === !0
    ));
  }
  captureSample(t, r, n, a, s, p) {
    const m = G.getCursorScreenPoint(), f = this.options.getDisplayBounds() ?? G.getDisplayNearestPoint(m).bounds, b = Math.max(1, f.width), F = Math.max(1, f.height), k = (m.x - f.x) / b, K = (m.y - f.y) / F;
    k < 0 || k > 1 || K < 0 || K > 1 ? this.consecutiveOutsideSamples++ : this.consecutiveOutsideSamples = 0;
    const Q = this.consecutiveOutsideSamples < yr.OUTSIDE_HIDE_THRESHOLD, oe = s || a && !this.previousLeftButtonDown ? "click" : p || !a && this.previousLeftButtonDown ? "mouseup" : "move";
    this.previousLeftButtonDown = a, this.samples.push({
      timeMs: Math.max(0, t - this.startTimeMs),
      cx: Fr(k, 0, 1),
      cy: Fr(K, 0, 1),
      visible: Q,
      interactionType: oe,
      ...n ? { assetId: n } : {},
      ...r ? { cursorType: r } : {}
    }), this.samples.length > this.options.maxSamples && this.samples.shift();
  }
  waitUntilReady() {
    return new Promise((t, r) => {
      this.readyResolve = t, this.readyReject = r, this.readyTimer = setTimeout(() => {
        this.rejectReady(new Error("Timed out waiting for macOS cursor helper"));
      }, mn);
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
function Dr(e, t, r) {
  return Math.min(r, Math.max(t, e));
}
class Ya {
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
    const t = G.getCursorScreenPoint(), r = this.options.getDisplayBounds() ?? G.getDisplayNearestPoint(t).bounds, n = Math.max(1, r.width), a = Math.max(1, r.height);
    this.samples.push({
      timeMs: Math.max(0, Date.now() - this.startTimeMs),
      cx: Dr((t.x - r.x) / n, 0, 1),
      cy: Dr((t.y - r.y) / a, 0, 1),
      visible: !0
    }), this.samples.length > this.options.maxSamples && this.samples.shift();
  }
}
function Ja(e) {
  if (!e?.startsWith("window:"))
    return null;
  const t = e.split(":")[1];
  return !t || !/^\d+$/.test(t) ? null : t;
}
function Xa() {
  const e = process.env.OPENSCREEN_CURSOR_SAMPLER_EXE?.trim(), t = process.arch === "arm64" ? "win32-arm64" : "win32-x64", r = (...a) => {
    const s = Sr(N.getAppPath(), ...a);
    return N.isPackaged ? s.replace(/\.asar([/\\])/, ".asar.unpacked$1") : s;
  }, n = (...a) => N.isPackaged ? Sr(process.resourcesPath, ...a) : null;
  return [
    e,
    r("electron", "native", "wgc-capture", "build", "cursor-sampler.exe"),
    r("electron", "native", "bin", t, "cursor-sampler.exe"),
    n("electron", "native", "bin", t, "cursor-sampler.exe")
  ].filter((a) => !!a);
}
function qa() {
  for (const e of Xa())
    if (Gn(e)) return e;
  return null;
}
const Za = 5e3;
class Qa {
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
    const t = qa();
    if (!t)
      throw new Error("Windows cursor sampler helper is not available.");
    const r = Ja(this.options.sourceId), n = [String(this.options.sampleIntervalMs)];
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
    }), a.stdout.setEncoding("utf8"), a.stdout.on("data", (s) => {
      this.handleStdoutChunk(s);
    }), a.stderr.setEncoding("utf8"), a.stderr.on("data", (s) => {
      const p = s.trim();
      p && this.logDiagnostic("stderr", { message: p }), console.error("[cursor-native]", p);
    }), a.once("exit", (s, p) => {
      this.logDiagnostic("exit", {
        code: s,
        signal: p,
        sampleCount: this.sampleCount,
        assetCount: this.assets.size,
        outOfBoundsSampleCount: this.outOfBoundsSampleCount
      }), this.rejectReady(
        new Error(`Windows cursor helper exited before ready (code=${s}, signal=${p})`)
      );
    }), a.once("error", (s) => {
      this.logDiagnostic("process-error", { message: s.message }), this.rejectReady(s);
    });
    try {
      await this.waitUntilReady();
    } catch (s) {
      throw this.terminateHelperProcess(), s;
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
          const s = JSON.parse(a);
          this.handleEvent(s);
        } catch (s) {
          console.error("Failed to parse Windows cursor helper output:", s, a);
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
      const n = G.getDisplayNearestPoint({ x: t.x, y: t.y });
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
    const r = t.bounds ?? this.options.getDisplayBounds() ?? G.getPrimaryDisplay().bounds, n = Math.max(1, r.width), a = Math.max(1, r.height), s = (t.x - r.x) / n, p = (t.y - r.y) / a, m = s >= 0 && s <= 1 && p >= 0 && p <= 1, f = t.leftButtonDown === !0, b = t.leftButtonPressed === !0, F = t.leftButtonReleased === !0, k = b || f && !this.previousLeftButtonDown ? "click" : F || !f && this.previousLeftButtonDown ? "mouseup" : "move";
    return this.previousLeftButtonDown = f, (this.sampleCount === 0 || !m && this.outOfBoundsSampleCount === 0) && this.logDiagnostic("sample", {
      rawX: t.x,
      rawY: t.y,
      normalizedX: s,
      normalizedY: p,
      visible: t.visible,
      withinBounds: m,
      bounds: r,
      handle: t.handle
    }), {
      withinBounds: m,
      sample: {
        timeMs: Math.max(0, t.timestampMs - this.startTimeMs),
        cx: s,
        cy: p,
        assetId: t.handle,
        visible: t.visible && m,
        cursorType: t.cursorType ?? t.asset?.cursorType ?? null,
        interactionType: k
      }
    };
  }
  waitUntilReady() {
    return new Promise((t, r) => {
      this.readyResolve = t, this.readyReject = r, this.readyTimer = setTimeout(() => {
        this.rejectReady(new Error("Timed out waiting for Windows cursor helper readiness"));
      }, Za);
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
function es(e) {
  return e.platform === "win32" ? new Qa({
    getDisplayBounds: e.getDisplayBounds,
    maxSamples: e.maxSamples,
    sampleIntervalMs: e.sampleIntervalMs,
    sourceId: e.sourceId,
    startTimeMs: e.startTimeMs
  }) : e.platform === "darwin" ? new yr({
    getDisplayBounds: e.getDisplayBounds,
    maxSamples: e.maxSamples,
    sampleIntervalMs: e.sampleIntervalMs,
    startTimeMs: e.startTimeMs
  }) : new Ya({
    getDisplayBounds: e.getDisplayBounds,
    maxSamples: e.maxSamples,
    sampleIntervalMs: e.sampleIntervalMs,
    startTimeMs: e.startTimeMs
  });
}
var Ar = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {}, Ht = {}, Kt = { exports: {} }, Or;
function zt() {
  return Or || (Or = 1, (function(e) {
    var t, r, n, a, s, p, m, f, b, F, k, K, de, Q, oe, ee, Ke, Ye, pe, vt, l, o, i, c, w, P, v, g, A, O, M, B;
    (function(j) {
      var J = typeof Ar == "object" ? Ar : typeof self == "object" ? self : typeof this == "object" ? this : {};
      j(Ce(J, Ce(e.exports)));
      function Ce(ae, Je) {
        return ae !== J && (typeof Object.create == "function" ? Object.defineProperty(ae, "__esModule", { value: !0 }) : ae.__esModule = !0), function(u, d) {
          return ae[u] = Je ? Je(u, d) : d;
        };
      }
    })(function(j) {
      var J = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(u, d) {
        u.__proto__ = d;
      } || function(u, d) {
        for (var h in d) Object.prototype.hasOwnProperty.call(d, h) && (u[h] = d[h]);
      };
      t = function(u, d) {
        if (typeof d != "function" && d !== null)
          throw new TypeError("Class extends value " + String(d) + " is not a constructor or null");
        J(u, d);
        function h() {
          this.constructor = u;
        }
        u.prototype = d === null ? Object.create(d) : (h.prototype = d.prototype, new h());
      }, r = Object.assign || function(u) {
        for (var d, h = 1, y = arguments.length; h < y; h++) {
          d = arguments[h];
          for (var T in d) Object.prototype.hasOwnProperty.call(d, T) && (u[T] = d[T]);
        }
        return u;
      }, n = function(u, d) {
        var h = {};
        for (var y in u) Object.prototype.hasOwnProperty.call(u, y) && d.indexOf(y) < 0 && (h[y] = u[y]);
        if (u != null && typeof Object.getOwnPropertySymbols == "function")
          for (var T = 0, y = Object.getOwnPropertySymbols(u); T < y.length; T++)
            d.indexOf(y[T]) < 0 && Object.prototype.propertyIsEnumerable.call(u, y[T]) && (h[y[T]] = u[y[T]]);
        return h;
      }, a = function(u, d, h, y) {
        var T = arguments.length, x = T < 3 ? d : y === null ? y = Object.getOwnPropertyDescriptor(d, h) : y, I;
        if (typeof Reflect == "object" && typeof Reflect.decorate == "function") x = Reflect.decorate(u, d, h, y);
        else for (var V = u.length - 1; V >= 0; V--) (I = u[V]) && (x = (T < 3 ? I(x) : T > 3 ? I(d, h, x) : I(d, h)) || x);
        return T > 3 && x && Object.defineProperty(d, h, x), x;
      }, s = function(u, d) {
        return function(h, y) {
          d(h, y, u);
        };
      }, p = function(u, d, h, y, T, x) {
        function I(Fe) {
          if (Fe !== void 0 && typeof Fe != "function") throw new TypeError("Function expected");
          return Fe;
        }
        for (var V = y.kind, X = V === "getter" ? "get" : V === "setter" ? "set" : "value", E = !d && u ? y.static ? u : u.prototype : null, $ = d || (E ? Object.getOwnPropertyDescriptor(E, y.name) : {}), Y, Xe = !1, U = h.length - 1; U >= 0; U--) {
          var te = {};
          for (var re in y) te[re] = re === "access" ? {} : y[re];
          for (var re in y.access) te.access[re] = y.access[re];
          te.addInitializer = function(Fe) {
            if (Xe) throw new TypeError("Cannot add initializers after decoration has completed");
            x.push(I(Fe || null));
          };
          var se = (0, h[U])(V === "accessor" ? { get: $.get, set: $.set } : $[X], te);
          if (V === "accessor") {
            if (se === void 0) continue;
            if (se === null || typeof se != "object") throw new TypeError("Object expected");
            (Y = I(se.get)) && ($.get = Y), (Y = I(se.set)) && ($.set = Y), (Y = I(se.init)) && T.unshift(Y);
          } else (Y = I(se)) && (V === "field" ? T.unshift(Y) : $[X] = Y);
        }
        E && Object.defineProperty(E, y.name, $), Xe = !0;
      }, m = function(u, d, h) {
        for (var y = arguments.length > 2, T = 0; T < d.length; T++)
          h = y ? d[T].call(u, h) : d[T].call(u);
        return y ? h : void 0;
      }, f = function(u) {
        return typeof u == "symbol" ? u : "".concat(u);
      }, b = function(u, d, h) {
        return typeof d == "symbol" && (d = d.description ? "[".concat(d.description, "]") : ""), Object.defineProperty(u, "name", { configurable: !0, value: h ? "".concat(h, " ", d) : d });
      }, F = function(u, d) {
        if (typeof Reflect == "object" && typeof Reflect.metadata == "function") return Reflect.metadata(u, d);
      }, k = function(u, d, h, y) {
        function T(x) {
          return x instanceof h ? x : new h(function(I) {
            I(x);
          });
        }
        return new (h || (h = Promise))(function(x, I) {
          function V($) {
            try {
              E(y.next($));
            } catch (Y) {
              I(Y);
            }
          }
          function X($) {
            try {
              E(y.throw($));
            } catch (Y) {
              I(Y);
            }
          }
          function E($) {
            $.done ? x($.value) : T($.value).then(V, X);
          }
          E((y = y.apply(u, d || [])).next());
        });
      }, K = function(u, d) {
        var h = { label: 0, sent: function() {
          if (x[0] & 1) throw x[1];
          return x[1];
        }, trys: [], ops: [] }, y, T, x, I = Object.create((typeof Iterator == "function" ? Iterator : Object).prototype);
        return I.next = V(0), I.throw = V(1), I.return = V(2), typeof Symbol == "function" && (I[Symbol.iterator] = function() {
          return this;
        }), I;
        function V(E) {
          return function($) {
            return X([E, $]);
          };
        }
        function X(E) {
          if (y) throw new TypeError("Generator is already executing.");
          for (; I && (I = 0, E[0] && (h = 0)), h; ) try {
            if (y = 1, T && (x = E[0] & 2 ? T.return : E[0] ? T.throw || ((x = T.return) && x.call(T), 0) : T.next) && !(x = x.call(T, E[1])).done) return x;
            switch (T = 0, x && (E = [E[0] & 2, x.value]), E[0]) {
              case 0:
              case 1:
                x = E;
                break;
              case 4:
                return h.label++, { value: E[1], done: !1 };
              case 5:
                h.label++, T = E[1], E = [0];
                continue;
              case 7:
                E = h.ops.pop(), h.trys.pop();
                continue;
              default:
                if (x = h.trys, !(x = x.length > 0 && x[x.length - 1]) && (E[0] === 6 || E[0] === 2)) {
                  h = 0;
                  continue;
                }
                if (E[0] === 3 && (!x || E[1] > x[0] && E[1] < x[3])) {
                  h.label = E[1];
                  break;
                }
                if (E[0] === 6 && h.label < x[1]) {
                  h.label = x[1], x = E;
                  break;
                }
                if (x && h.label < x[2]) {
                  h.label = x[2], h.ops.push(E);
                  break;
                }
                x[2] && h.ops.pop(), h.trys.pop();
                continue;
            }
            E = d.call(u, h);
          } catch ($) {
            E = [6, $], T = 0;
          } finally {
            y = x = 0;
          }
          if (E[0] & 5) throw E[1];
          return { value: E[0] ? E[1] : void 0, done: !0 };
        }
      }, de = function(u, d) {
        for (var h in u) h !== "default" && !Object.prototype.hasOwnProperty.call(d, h) && A(d, u, h);
      }, A = Object.create ? (function(u, d, h, y) {
        y === void 0 && (y = h);
        var T = Object.getOwnPropertyDescriptor(d, h);
        (!T || ("get" in T ? !d.__esModule : T.writable || T.configurable)) && (T = { enumerable: !0, get: function() {
          return d[h];
        } }), Object.defineProperty(u, y, T);
      }) : (function(u, d, h, y) {
        y === void 0 && (y = h), u[y] = d[h];
      }), Q = function(u) {
        var d = typeof Symbol == "function" && Symbol.iterator, h = d && u[d], y = 0;
        if (h) return h.call(u);
        if (u && typeof u.length == "number") return {
          next: function() {
            return u && y >= u.length && (u = void 0), { value: u && u[y++], done: !u };
          }
        };
        throw new TypeError(d ? "Object is not iterable." : "Symbol.iterator is not defined.");
      }, oe = function(u, d) {
        var h = typeof Symbol == "function" && u[Symbol.iterator];
        if (!h) return u;
        var y = h.call(u), T, x = [], I;
        try {
          for (; (d === void 0 || d-- > 0) && !(T = y.next()).done; ) x.push(T.value);
        } catch (V) {
          I = { error: V };
        } finally {
          try {
            T && !T.done && (h = y.return) && h.call(y);
          } finally {
            if (I) throw I.error;
          }
        }
        return x;
      }, ee = function() {
        for (var u = [], d = 0; d < arguments.length; d++)
          u = u.concat(oe(arguments[d]));
        return u;
      }, Ke = function() {
        for (var u = 0, d = 0, h = arguments.length; d < h; d++) u += arguments[d].length;
        for (var y = Array(u), T = 0, d = 0; d < h; d++)
          for (var x = arguments[d], I = 0, V = x.length; I < V; I++, T++)
            y[T] = x[I];
        return y;
      }, Ye = function(u, d, h) {
        if (h || arguments.length === 2) for (var y = 0, T = d.length, x; y < T; y++)
          (x || !(y in d)) && (x || (x = Array.prototype.slice.call(d, 0, y)), x[y] = d[y]);
        return u.concat(x || Array.prototype.slice.call(d));
      }, pe = function(u) {
        return this instanceof pe ? (this.v = u, this) : new pe(u);
      }, vt = function(u, d, h) {
        if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
        var y = h.apply(u, d || []), T, x = [];
        return T = Object.create((typeof AsyncIterator == "function" ? AsyncIterator : Object).prototype), V("next"), V("throw"), V("return", I), T[Symbol.asyncIterator] = function() {
          return this;
        }, T;
        function I(U) {
          return function(te) {
            return Promise.resolve(te).then(U, Y);
          };
        }
        function V(U, te) {
          y[U] && (T[U] = function(re) {
            return new Promise(function(se, Fe) {
              x.push([U, re, se, Fe]) > 1 || X(U, re);
            });
          }, te && (T[U] = te(T[U])));
        }
        function X(U, te) {
          try {
            E(y[U](te));
          } catch (re) {
            Xe(x[0][3], re);
          }
        }
        function E(U) {
          U.value instanceof pe ? Promise.resolve(U.value.v).then($, Y) : Xe(x[0][2], U);
        }
        function $(U) {
          X("next", U);
        }
        function Y(U) {
          X("throw", U);
        }
        function Xe(U, te) {
          U(te), x.shift(), x.length && X(x[0][0], x[0][1]);
        }
      }, l = function(u) {
        var d, h;
        return d = {}, y("next"), y("throw", function(T) {
          throw T;
        }), y("return"), d[Symbol.iterator] = function() {
          return this;
        }, d;
        function y(T, x) {
          d[T] = u[T] ? function(I) {
            return (h = !h) ? { value: pe(u[T](I)), done: !1 } : x ? x(I) : I;
          } : x;
        }
      }, o = function(u) {
        if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
        var d = u[Symbol.asyncIterator], h;
        return d ? d.call(u) : (u = typeof Q == "function" ? Q(u) : u[Symbol.iterator](), h = {}, y("next"), y("throw"), y("return"), h[Symbol.asyncIterator] = function() {
          return this;
        }, h);
        function y(x) {
          h[x] = u[x] && function(I) {
            return new Promise(function(V, X) {
              I = u[x](I), T(V, X, I.done, I.value);
            });
          };
        }
        function T(x, I, V, X) {
          Promise.resolve(X).then(function(E) {
            x({ value: E, done: V });
          }, I);
        }
      }, i = function(u, d) {
        return Object.defineProperty ? Object.defineProperty(u, "raw", { value: d }) : u.raw = d, u;
      };
      var Ce = Object.create ? (function(u, d) {
        Object.defineProperty(u, "default", { enumerable: !0, value: d });
      }) : function(u, d) {
        u.default = d;
      }, ae = function(u) {
        return ae = Object.getOwnPropertyNames || function(d) {
          var h = [];
          for (var y in d) Object.prototype.hasOwnProperty.call(d, y) && (h[h.length] = y);
          return h;
        }, ae(u);
      };
      c = function(u) {
        if (u && u.__esModule) return u;
        var d = {};
        if (u != null) for (var h = ae(u), y = 0; y < h.length; y++) h[y] !== "default" && A(d, u, h[y]);
        return Ce(d, u), d;
      }, w = function(u) {
        return u && u.__esModule ? u : { default: u };
      }, P = function(u, d, h, y) {
        if (h === "a" && !y) throw new TypeError("Private accessor was defined without a getter");
        if (typeof d == "function" ? u !== d || !y : !d.has(u)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
        return h === "m" ? y : h === "a" ? y.call(u) : y ? y.value : d.get(u);
      }, v = function(u, d, h, y, T) {
        if (y === "m") throw new TypeError("Private method is not writable");
        if (y === "a" && !T) throw new TypeError("Private accessor was defined without a setter");
        if (typeof d == "function" ? u !== d || !T : !d.has(u)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
        return y === "a" ? T.call(u, h) : T ? T.value = h : d.set(u, h), h;
      }, g = function(u, d) {
        if (d === null || typeof d != "object" && typeof d != "function") throw new TypeError("Cannot use 'in' operator on non-object");
        return typeof u == "function" ? d === u : u.has(d);
      }, O = function(u, d, h) {
        if (d != null) {
          if (typeof d != "object" && typeof d != "function") throw new TypeError("Object expected.");
          var y, T;
          if (h) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            y = d[Symbol.asyncDispose];
          }
          if (y === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            y = d[Symbol.dispose], h && (T = y);
          }
          if (typeof y != "function") throw new TypeError("Object not disposable.");
          T && (y = function() {
            try {
              T.call(this);
            } catch (x) {
              return Promise.reject(x);
            }
          }), u.stack.push({ value: d, dispose: y, async: h });
        } else h && u.stack.push({ async: !0 });
        return d;
      };
      var Je = typeof SuppressedError == "function" ? SuppressedError : function(u, d, h) {
        var y = new Error(h);
        return y.name = "SuppressedError", y.error = u, y.suppressed = d, y;
      };
      M = function(u) {
        function d(x) {
          u.error = u.hasError ? new Je(x, u.error, "An error was suppressed during disposal.") : x, u.hasError = !0;
        }
        var h, y = 0;
        function T() {
          for (; h = u.stack.pop(); )
            try {
              if (!h.async && y === 1) return y = 0, u.stack.push(h), Promise.resolve().then(T);
              if (h.dispose) {
                var x = h.dispose.call(h.value);
                if (h.async) return y |= 2, Promise.resolve(x).then(T, function(I) {
                  return d(I), T();
                });
              } else y |= 1;
            } catch (I) {
              d(I);
            }
          if (y === 1) return u.hasError ? Promise.reject(u.error) : Promise.resolve();
          if (u.hasError) throw u.error;
        }
        return T();
      }, B = function(u, d) {
        return typeof u == "string" && /^\.\.?\//.test(u) ? u.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(h, y, T, x, I) {
          return y ? d ? ".jsx" : ".js" : T && (!x || !I) ? h : T + x + "." + I.toLowerCase() + "js";
        }) : u;
      }, j("__extends", t), j("__assign", r), j("__rest", n), j("__decorate", a), j("__param", s), j("__esDecorate", p), j("__runInitializers", m), j("__propKey", f), j("__setFunctionName", b), j("__metadata", F), j("__awaiter", k), j("__generator", K), j("__exportStar", de), j("__createBinding", A), j("__values", Q), j("__read", oe), j("__spread", ee), j("__spreadArrays", Ke), j("__spreadArray", Ye), j("__await", pe), j("__asyncGenerator", vt), j("__asyncDelegator", l), j("__asyncValues", o), j("__makeTemplateObject", i), j("__importStar", c), j("__importDefault", w), j("__classPrivateFieldGet", P), j("__classPrivateFieldSet", v), j("__classPrivateFieldIn", g), j("__addDisposableResource", O), j("__disposeResources", M), j("__rewriteRelativeImportExtension", B);
    });
  })(Kt)), Kt.exports;
}
var qe = {}, Yt = {}, Ze = {}, jr;
function wt() {
  if (jr) return Ze;
  jr = 1, Object.defineProperty(Ze, "__esModule", { value: !0 }), Ze.WebmBase = void 0;
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
var Qe = {}, et = {}, tt = {}, Ir;
function gr() {
  if (Ir) return tt;
  Ir = 1, Object.defineProperty(tt, "__esModule", { value: !0 }), tt.SectionType = void 0;
  var e;
  return (function(t) {
    t.Container = "Container", t.Uint = "Uint", t.Int = "Int", t.Float = "Float", t.String = "String", t.Date = "Date", t.Binary = "Binary";
  })(e || (tt.SectionType = e = {})), tt;
}
var _r;
function hn() {
  if (_r) return et;
  _r = 1, Object.defineProperty(et, "__esModule", { value: !0 }), et.sections = void 0;
  const e = gr();
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
var rt = {}, Er;
function yn() {
  if (Er) return rt;
  Er = 1, Object.defineProperty(rt, "__esModule", { value: !0 }), rt.WebmUint = void 0;
  const e = wt();
  function t(n) {
    return n.length % 2 === 1 ? "0" + n : n;
  }
  let r = class extends e.WebmBase {
    constructor(a, s = 0) {
      super(a, s);
    }
    getType() {
      return "Uint";
    }
    updateBySource() {
      this.data = "";
      for (let a = 0; a < this.source.length; a++) {
        const s = this.source[a].toString(16);
        this.data += t(s);
      }
    }
    updateByData() {
      const a = this.data.length / 2;
      this.source = new Uint8Array(a);
      for (let s = 0; s < a; s++) {
        const p = this.data.substring(s * 2, s * 2 + 2);
        this.source[s] = parseInt(p, 16);
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
var nt = {}, Mr;
function gn() {
  if (Mr) return nt;
  Mr = 1, Object.defineProperty(nt, "__esModule", { value: !0 }), nt.WebmFloat = void 0;
  const e = wt();
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
      const n = this.source.reverse(), a = this.getFloatArrayType(), s = new a(n.buffer);
      this.data = s[0];
    }
    updateByData() {
      const n = this.getFloatArrayType(), a = new n([this.data]), s = new Uint8Array(a.buffer);
      this.source = s.reverse();
    }
  };
  return nt.WebmFloat = t, nt;
}
var ot = {}, kr;
function wn() {
  if (kr) return ot;
  kr = 1, Object.defineProperty(ot, "__esModule", { value: !0 }), ot.WebmString = void 0;
  const e = wt();
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
var Rr;
function vn() {
  if (Rr) return Qe;
  Rr = 1, Object.defineProperty(Qe, "__esModule", { value: !0 }), Qe.WebmContainer = void 0;
  const e = wt(), t = hn(), r = gr(), n = yn(), a = gn(), s = wn();
  let p = class ir extends e.WebmBase {
    constructor(f, b = !1, F = 0) {
      super(f, F), this.isInfinite = b, this.offset = 0;
    }
    getType() {
      return "Container";
    }
    readByte() {
      return this.source[this.offset++];
    }
    readUint() {
      const f = this.readByte(), b = 8 - f.toString(2).length;
      let F = f - (1 << 7 - b);
      for (let k = 0; k < b; k++)
        F <<= 8, F |= this.readByte();
      return F;
    }
    updateBySource() {
      var f;
      this.data = [];
      let b;
      for (this.offset = 0; this.offset < this.source.length; this.offset = b) {
        const F = this.offset, k = this.readUint(), { name: K, type: de } = (f = t.sections[k]) !== null && f !== void 0 ? f : {}, Q = this.readUint();
        b = this.source.length, Q >= 0 && (b = Math.min(this.offset + Q, b));
        const oe = this.source.slice(this.offset, b);
        let ee;
        switch (de) {
          case r.SectionType.Container:
            ee = new ir(K, Q < 0, F);
            break;
          case r.SectionType.Uint:
            ee = new n.WebmUint(K, F);
            break;
          case r.SectionType.Float:
            ee = new a.WebmFloat(K, F);
            break;
          case r.SectionType.String:
            ee = new s.WebmString(K, F);
            break;
          default:
            ee = new e.WebmBase(K, F);
            break;
        }
        ee.setSource(oe), this.data.push({
          id: k,
          idHex: k.toString(16),
          data: ee
        });
      }
    }
    writeUint(f, b = !1) {
      let F;
      for (F = 1; (f < 0 || f >= 1 << 7 * F) && F < 8; F++)
        ;
      if (!b) {
        for (let k = 0; k < F; k++)
          this.source[this.offset + k] = f >> 8 * (F - 1 - k) & 255;
        this.source[this.offset] &= (1 << 8 - F) - 1, this.source[this.offset] |= 1 << 8 - F;
      }
      this.offset += F;
    }
    writeSections(f = !1) {
      this.offset = 0;
      for (let b = 0; b < this.data.length; b++) {
        const F = this.data[b], k = F.data.source, K = k.length;
        this.writeUint(F.id, f), this.writeUint(F.data instanceof ir && F.data.isInfinite ? -1 : K, f), f || this.source.set(k, this.offset), this.offset += K;
      }
      return this.offset;
    }
    updateByData() {
      const f = this.writeSections(!0);
      this.source = new Uint8Array(f), this.writeSections();
    }
    getSectionById(f) {
      for (let b = 0; b < this.data.length; b++) {
        const F = this.data[b];
        if (F.id === f)
          return F.data;
      }
      return null;
    }
  };
  return Qe.WebmContainer = p, Qe;
}
var at = {}, Nr;
function ts() {
  if (Nr) return at;
  Nr = 1, Object.defineProperty(at, "__esModule", { value: !0 }), at.WebmFile = void 0;
  const e = /* @__PURE__ */ zt(), t = vn();
  let r = class cr extends t.WebmContainer {
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
      return new Promise((s, p) => {
        try {
          const m = new FileReader();
          m.onloadend = () => {
            try {
              s(new Uint8Array(m.result));
            } catch (f) {
              p(f);
            }
          }, m.readAsArrayBuffer(a);
        } catch (m) {
          p(m);
        }
      });
    }
    static fromBlob(a) {
      return e.__awaiter(this, void 0, void 0, function* () {
        const s = yield cr.blobToArray(a);
        return new cr(s);
      });
    }
  };
  return at.WebmFile = r, at;
}
var Jt = {}, Vr;
function rs() {
  return Vr || (Vr = 1, Object.defineProperty(Jt, "__esModule", { value: !0 })), Jt;
}
var Br;
function wr() {
  return Br || (Br = 1, (function(e) {
    Object.defineProperty(e, "__esModule", { value: !0 });
    const t = /* @__PURE__ */ zt();
    t.__exportStar(wt(), e), t.__exportStar(vn(), e), t.__exportStar(ts(), e), t.__exportStar(gn(), e), t.__exportStar(wn(), e), t.__exportStar(yn(), e), t.__exportStar(gr(), e), t.__exportStar(rs(), e), t.__exportStar(hn(), e);
  })(Yt)), Yt;
}
var st = {}, zr;
function Sn() {
  if (zr) return st;
  zr = 1, Object.defineProperty(st, "__esModule", { value: !0 }), st.fixParsedWebmDuration = void 0;
  const e = wr(), t = (r, n, a = {}) => {
    let s = a.logger;
    s === void 0 ? s = (F) => console.debug(F) : s || (s = () => {
    });
    const p = r.getSectionById(139690087);
    if (!p)
      return s("[fix-webm-duration] Segment section is missing"), !1;
    const m = p.getSectionById(88713574);
    if (!m)
      return s("[fix-webm-duration] Info section is missing"), !1;
    const f = m.getSectionById(710577);
    if (!f)
      return s("[fix-webm-duration] TimecodeScale section is missing"), !1;
    let b = m.getSectionById(1161);
    if (b)
      if (b.getValue() <= 0)
        s(`[fix-webm-duration] Duration section is present, but the value is ${b.getValue()}`), b.setValue(n);
      else
        return s(`[fix-webm-duration] Duration section is present, and the value is ${b.getValue()}`), !1;
    else
      s("[fix-webm-duration] Duration section is missing"), b = new e.WebmFloat("Duration"), b.setValue(n), m.data.push({
        id: 1161,
        data: b
      });
    return f.setValue(1e6), m.updateByData(), p.updateByData(), r.updateByData(), !0;
  };
  return st.fixParsedWebmDuration = t, st;
}
var Ur;
function ns() {
  if (Ur) return qe;
  Ur = 1, Object.defineProperty(qe, "__esModule", { value: !0 }), qe.fixWebmDuration = void 0;
  const e = /* @__PURE__ */ zt(), t = wr(), r = Sn(), n = (a, s, p) => e.__awaiter(void 0, void 0, void 0, function* () {
    try {
      const m = yield t.WebmFile.fromBlob(a);
      if ((0, r.fixParsedWebmDuration)(m, s, p))
        return m.toBlob(a.type);
    } catch {
    }
    return a;
  });
  return qe.fixWebmDuration = n, qe;
}
var Wr;
function os() {
  return Wr || (Wr = 1, (function(e) {
    Object.defineProperty(e, "__esModule", { value: !0 });
    const t = /* @__PURE__ */ zt();
    t.__exportStar(ns(), e), t.__exportStar(Sn(), e);
  })(Ht)), Ht;
}
var as = os(), ss = wr();
async function Lr(e, t) {
  try {
    const r = await D.readFile(e), n = new ss.WebmFile(new Uint8Array(r));
    if (!as.fixParsedWebmDuration(n, t, { logger: !1 })) {
      const m = is(n);
      return m === "no-section" && console.warn(
        `[webm-duration] no Segment/Info section in ${e}; file may be truncated`
      ), { patched: !1, reason: m };
    }
    if (!n.source)
      return console.error(`[webm-duration] patched but source missing for ${e}`), { patched: !1, reason: "internal" };
    const s = `${e}.duration-patch.tmp`, p = Buffer.from(
      n.source.buffer,
      n.source.byteOffset,
      n.source.byteLength
    );
    try {
      return await D.writeFile(s, p), await D.rename(s, e), { patched: !0 };
    } catch (m) {
      return console.error(`[webm-duration] failed to write patched ${e}:`, m), await D.unlink(s).catch(() => {
      }), { patched: !1, reason: "io-error" };
    }
  } catch (r) {
    return console.error(`[webm-duration] failed to patch ${e}:`, r), { patched: !1, reason: "io-error" };
  }
}
function is(e) {
  const t = e.getSectionById?.(139690087);
  return t && t.getSectionById?.(88713574) ? "already-valid" : "no-section";
}
const $r = "native-bridge:invoke", bn = 1;
class cs {
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
class ls {
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
class us {
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
class ds {
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
      bridgeVersion: bn,
      platform: t,
      cursor: r,
      project: {
        currentContext: !0
      }
    };
    return this.options.store.setSystemCapabilities(n), n;
  }
}
class ps {
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
function ms(e) {
  return e === "darwin" || e === "win32" ? e : "linux";
}
function Pn(e) {
  return {
    version: bn,
    requestId: e || `native-${Date.now()}`,
    timestampMs: Date.now()
  };
}
function q(e, t) {
  return {
    ok: !0,
    data: t,
    meta: Pn(e)
  };
}
function Be(e, t, r, n = !1) {
  return {
    ok: !1,
    error: {
      code: t,
      message: r,
      retryable: n
    },
    meta: Pn(e)
  };
}
function fs(e) {
  if (!e || typeof e != "object")
    return !1;
  const t = e;
  return typeof t.domain == "string" && typeof t.action == "string";
}
function hs(e) {
  C.removeHandler($r);
  const t = ms(e.getPlatform()), r = new ps(t), n = new us({
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
  }), a = new ls({
    store: r,
    adapter: new cs({
      loadRecordingData: e.loadCursorRecordingData,
      resolveVideoPath: e.resolveVideoPath,
      loadTelemetry: e.loadCursorTelemetry
    })
  }), s = new ds({
    store: r,
    getPlatform: () => t,
    getAssetBasePath: e.resolveAssetBasePath,
    getCursorCapabilities: () => a.getCapabilities()
  });
  C.handle($r, async (p, m) => {
    if (!fs(m))
      return Be(void 0, "INVALID_REQUEST", "Invalid native bridge request.");
    const f = m.requestId, b = m.domain;
    try {
      switch (m.domain) {
        case "system": {
          const F = m.action;
          switch (m.action) {
            case "getPlatform":
              return q(f, s.getPlatform());
            case "getAssetBasePath":
              return q(f, s.getAssetBasePath());
            case "getCapabilities":
              return q(f, await s.getCapabilities());
            default:
              return Be(
                f,
                "UNSUPPORTED_ACTION",
                `Unsupported system action: ${F}`
              );
          }
        }
        case "project": {
          const F = m.action;
          switch (m.action) {
            case "getCurrentContext":
              return q(f, n.getCurrentContext());
            case "saveProjectFile":
              return q(
                f,
                await n.saveProjectFile(
                  m.payload.projectData,
                  m.payload.suggestedName,
                  m.payload.existingProjectPath
                )
              );
            case "loadProjectFile":
              return q(
                f,
                await n.loadProjectFile(m.payload?.projectFolder)
              );
            case "loadCurrentProjectFile":
              return q(
                f,
                await n.loadCurrentProjectFile()
              );
            case "loadProjectFileFromPath":
              return q(
                f,
                await n.loadProjectFileFromPath(m.payload.path)
              );
            case "setCurrentVideoPath":
              return q(
                f,
                await n.setCurrentVideoPath(m.payload.path)
              );
            case "getCurrentVideoPath":
              return q(f, n.getCurrentVideoPath());
            case "clearCurrentVideoPath":
              return q(f, n.clearCurrentVideoPath());
            default:
              return Be(
                f,
                "UNSUPPORTED_ACTION",
                `Unsupported project action: ${F}`
              );
          }
        }
        case "cursor": {
          const F = m.action;
          switch (m.action) {
            case "getCapabilities":
              return q(f, await a.getCapabilities());
            case "getTelemetry":
              return q(
                f,
                await a.getTelemetry(m.payload?.videoPath)
              );
            case "getRecordingData":
              return q(
                f,
                await a.getRecordingData(m.payload?.videoPath)
              );
            default:
              return Be(
                f,
                "UNSUPPORTED_ACTION",
                `Unsupported cursor action: ${F}`
              );
          }
        }
        default:
          return Be(
            f,
            "UNSUPPORTED_ACTION",
            `Unsupported bridge domain: ${b}`
          );
      }
    } catch (F) {
      return Be(
        f,
        "INTERNAL_ERROR",
        F instanceof Error ? F.message : "Unknown native bridge error.",
        !0
      );
    }
  });
}
function Tn(e) {
  const t = [], r = e.split(/\n----\n/g).slice(1);
  for (const n of r) {
    if (!/^Data format:/m.test(n) || !/\baudio packets:/i.test(n)) continue;
    const a = n.match(/\bbit rate:\s*([0-9]+)\s*bits per second/i);
    t.push(a ? Number(a[1]) : 0);
  }
  return t;
}
function ys(e, t) {
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
class gs {
  streams = /* @__PURE__ */ new Map();
  /**
   * Open a write stream, resolving only on the `open` event so a bad path or
   * permission error rejects here instead of becoming a silent chunk drop later,
   * letting the renderer's fallback take over.
   */
  async open(t, r) {
    await this.endStream(t);
    const n = Hn(r, { flags: "w" });
    await new Promise((a, s) => {
      const p = (m) => s(m);
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
    await new Promise((a, s) => {
      n.write(r, (p) => p ? s(p) : a());
    });
  }
  /**
   * Flush and close the stream, keeping the file. Returns true if a stream was
   * open (streamed to disk) or false if the caller still needs to write its buffer.
   */
  async finalize(t) {
    const r = this.streams.get(t);
    return r ? (this.streams.delete(t), await new Promise((n, a) => {
      r.end((s) => s ? a(s) : n());
    }), !0) : !1;
  }
  /**
   * Close the stream (if any) and delete the partial file, so a discarded or
   * failed recording doesn't leak descriptors or orphan partial files on disk.
   */
  async discard(t, r) {
    await this.endStream(t), await Bn(r).catch(() => {
    });
  }
  async endStream(t) {
    const r = this.streams.get(t);
    r && (this.streams.delete(t), await new Promise((n) => r.end(() => n())));
  }
}
function ws(e, t, r) {
  e.handle(
    "open-recording-stream",
    async (n, a) => {
      try {
        return await t.open(a, r(a)), { success: !0 };
      } catch (s) {
        return { success: !1, error: String(s) };
      }
    }
  ), e.handle(
    "append-recording-chunk",
    async (n, a, s) => {
      try {
        return await t.append(a, Buffer.from(s)), { success: !0 };
      } catch (p) {
        return { success: !1, error: String(p) };
      }
    }
  ), e.handle(
    "close-recording-stream",
    async (n, a) => {
      try {
        return await t.discard(a, r(a)), { success: !0 };
      } catch (s) {
        return { success: !1, error: String(s) };
      }
    }
  );
}
const it = "openscreen", lr = S.join(N.getPath("userData"), "shortcuts.json"), xt = "recording-", We = ".session.json", vs = /* @__PURE__ */ new Set([
  ".webm",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".m4v",
  ".wmv",
  ".flv",
  ".ts"
]), ur = S.join(N.getPath("userData"), "preview-audio"), dr = S.join(N.getPath("userData"), "voiceover"), kt = S.join(N.getPath("userData"), "openai-api-key.bin"), vr = S.join(N.getPath("userData"), "openai-api-key.local.json"), Te = new Ln(), xn = /* @__PURE__ */ new Set(), Rt = /* @__PURE__ */ new Map();
let ct = null, Xt = 0;
async function Ss() {
  return ct?.listening || (ct = Yn(async (e, t) => {
    const r = e.url?.split("/media/")[1]?.split(/[?#]/, 1)[0], n = r ? Rt.get(r) : null;
    if (!n || n.expiresAt < Date.now()) {
      r && Rt.delete(r), t.writeHead(404).end();
      return;
    }
    try {
      const a = await D.stat(n.filePath), s = e.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
      let p = 0, m = Math.max(0, a.size - 1);
      if (s) {
        if (p = s[1] ? Number.parseInt(s[1], 10) : 0, m = s[2] ? Number.parseInt(s[2], 10) : m, p > m || p >= a.size) {
          t.writeHead(416, { "Content-Range": `bytes */${a.size}` }).end();
          return;
        }
        m = Math.min(m, a.size - 1);
      }
      const f = {
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Content-Length": String(m - p + 1),
        "Content-Type": "application/octet-stream"
      };
      s && (f["Content-Range"] = `bytes ${p}-${m}/${a.size}`), t.writeHead(s ? 206 : 200, f), Kn(n.filePath, { start: p, end: m }).pipe(t);
    } catch {
      t.writeHead(500).end();
    }
  }), await new Promise((e, t) => {
    ct.once("error", t), ct.listen(0, "127.0.0.1", () => {
      const r = ct.address();
      Xt = typeof r == "object" && r ? r.port : 0, e();
    });
  })), Xt;
}
function Nt(e) {
  xn.add(S.resolve(e));
}
function bs() {
  return [R, ur, dr];
}
function Ut(e, t) {
  const r = S.resolve(e), n = S.resolve(t);
  return r === n || r.startsWith(n + S.sep);
}
function Pe(e) {
  const t = S.resolve(e);
  return xn.has(t) ? !0 : bs().some((r) => Ut(t, r));
}
const Vt = "openscreen-local-key-pad";
function Ps(e) {
  const t = Buffer.from(e, "utf8");
  for (let r = 0; r < t.length; r++)
    t[r] ^= Vt.charCodeAt(r % Vt.length);
  return t.toString("base64");
}
function Ts(e) {
  const t = Buffer.from(e, "base64");
  for (let r = 0; r < t.length; r++)
    t[r] ^= Vt.charCodeAt(r % Vt.length);
  return t.toString("utf8");
}
async function lt() {
  if (Ie.isEncryptionAvailable())
    try {
      const e = await D.readFile(kt), t = Ie.decryptString(e).trim();
      if (t) return t;
    } catch {
    }
  try {
    const e = JSON.parse(await D.readFile(vr, "utf8")), t = typeof e.key == "string" ? Ts(e.key).trim() : "";
    return t ? (Ie.isEncryptionAvailable() && await D.writeFile(kt, Ie.encryptString(t), { mode: 384 }).catch(() => {
    }), t) : null;
  } catch {
    return null;
  }
}
async function xs(e) {
  const t = e.trim();
  return !t.startsWith("sk-") || t.length < 20 ? { success: !1, message: "Enter a valid OpenAI API key." } : (await D.writeFile(vr, JSON.stringify({ key: Ps(t) }), {
    mode: 384
  }), Ie.isEncryptionAvailable() && await D.writeFile(kt, Ie.encryptString(t), { mode: 384 }), { success: !0 });
}
function Cs(e) {
  const t = we(e);
  return !t || !Cn(t) || !Pe(t) ? null : t;
}
function Ct(e, t) {
  const r = t;
  return r && !r.isDestroyed() ? { ...e, parent: r } : e;
}
function Cn(e) {
  return vs.has(S.extname(e).toLowerCase());
}
function Bt(e, t, r) {
  return new Promise((n, a) => {
    const s = Ve(e, t, { stdio: ["ignore", "pipe", "pipe"] });
    let p = "", m = "", f = !1;
    const b = r?.timeoutMs ? setTimeout(() => {
      f = !0, s.kill("SIGKILL");
    }, r.timeoutMs) : null;
    s.stdout.on("data", (F) => {
      p += F.toString();
    }), s.stderr.on("data", (F) => {
      m += F.toString();
    }), s.on("error", (F) => {
      b && clearTimeout(b), a(F);
    }), s.on("close", (F) => {
      b && clearTimeout(b), n({ code: F, stdout: p, stderr: m, timedOut: f });
    });
  });
}
async function Fs(e, t) {
  const r = await le(e);
  if (!r)
    return {
      success: !1,
      message: "File path is not approved or is not a supported video file"
    };
  if (process.platform !== "darwin" || S.extname(r).toLowerCase() !== ".mp4")
    return { success: !0, path: null };
  const n = await Bt("/usr/bin/afinfo", [r]);
  if (n.code !== 0)
    return { success: !0, path: null };
  const a = Tn(`${n.stdout}
${n.stderr}`), s = ys(a, t);
  if (s === null)
    return { success: !0, path: null };
  await D.mkdir(ur, { recursive: !0 });
  const p = await D.stat(r), m = S.parse(r), f = S.join(
    ur,
    `${m.name}.track-${s + 1}.${Math.round(p.mtimeMs)}.m4a`
  );
  try {
    if ((await D.stat(f)).mtimeMs >= p.mtimeMs)
      return { success: !0, path: Le(f).toString() };
  } catch {
  }
  const b = await Bt("/usr/bin/afconvert", [
    "--read-track",
    String(s),
    "-f",
    "m4af",
    "-d",
    "aac",
    r,
    f
  ]);
  return b.code !== 0 ? {
    success: !1,
    message: b.stderr || b.stdout || "Failed to prepare preview audio"
  } : { success: !0, path: Le(f).toString() };
}
async function le(e, t) {
  const r = we(e);
  if (!r)
    return null;
  if (Pe(r))
    return r;
  if (!Cn(r))
    return null;
  if (t) {
    const n = S.resolve(r);
    if (!t.some((s) => Ut(n, s)))
      return null;
  }
  try {
    if (!(await D.stat(r)).isFile())
      return null;
  } catch {
    return null;
  }
  return Nt(r), r;
}
function Ft(e) {
  const t = e.trim();
  if (!t)
    throw new Error("Invalid recording file name");
  const r = S.parse(t), n = t.split(/[\\/]+/).some((s) => s === ".."), a = r.dir !== "" || S.isAbsolute(t) || t.includes("/") || t.includes("\\");
  if (n || a || r.base !== t)
    throw new Error("Recording file name must not contain path segments");
  return S.join(R, r.base);
}
function Ds(e) {
  return typeof e == "number" && Number.isFinite(e) && e > 0;
}
async function Gr(e, t, r, n) {
  const a = await e.finalize(t);
  return !a && n && n.byteLength > 0 && await D.writeFile(r, Buffer.from(n)), a;
}
async function qt(e, t) {
  if (!e || typeof e != "object")
    return null;
  const r = e, n = un(r.media) ?? (typeof r.videoPath == "string" ? {
    screenVideoPath: we(r.videoPath) ?? r.videoPath
  } : null);
  if (!n)
    return null;
  const a = [R];
  t && a.push(S.dirname(S.resolve(t)));
  const s = await le(n.screenVideoPath, a);
  if (!s)
    throw new Error("Project references an invalid or unsupported screen video path");
  const p = n.webcamVideoPath ? await le(n.webcamVideoPath, a) : void 0;
  if (n.webcamVideoPath && !p)
    throw new Error("Project references an invalid or unsupported webcam video path");
  return p ? { screenVideoPath: s, webcamVideoPath: p, createdAt: Date.now() } : { screenVideoPath: s, createdAt: Date.now() };
}
let Z = null, dt = null, Dt = /* @__PURE__ */ new Map(), H = null, ie = null;
function As() {
  return dt;
}
let he = null;
function ht(e) {
  return S.resolve(e);
}
function we(e) {
  if (typeof e != "string")
    return null;
  const t = e.trim();
  if (!t)
    return null;
  if (/^file:\/\//i.test(t))
    try {
      return hr(t);
    } catch {
    }
  return t;
}
function Os(e) {
  return !e || !H ? !1 : ht(e) === ht(H);
}
const js = 2, Is = 33, _s = 3600 * 30;
let ce = null, W = null, me = null, ue = "", _e = null, At = null, Ot = null, ze = 0, jt = "editable-overlay", Ee = 0, Me = null, pt = [], Ae = !1;
const Es = 15e3;
let fe = null, $e = "", ve = null, It = null, _t = null, ut = 0, Et = "editable-overlay", ke = 0, Re = null, mt = [], Oe = !1;
function Ms(e) {
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
function ks(e) {
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
async function Fn(e) {
  const t = `${e}.cursor.json`;
  try {
    const r = await D.readFile(t, "utf-8"), n = JSON.parse(r), a = Array.isArray(n) ? n : Array.isArray(n?.samples) ? n.samples : [], s = Array.isArray(n?.assets) ? n.assets : [], p = a.map((f) => Ms(f)).filter(
      (f) => !!f
    ).sort((f, b) => f.timeMs - b.timeMs), m = s.map((f) => ks(f)).filter((f) => !!f);
    return {
      version: typeof n?.version == "number" && Number.isFinite(n.version) ? n.version : 1,
      provider: n?.provider === "native" ? "native" : "none",
      samples: p,
      assets: m
    };
  } catch (r) {
    if (r.code === "ENOENT")
      return {
        version: js,
        provider: "none",
        samples: [],
        assets: []
      };
    throw console.error("Failed to load cursor telemetry:", r), r;
  }
}
async function Hr(e) {
  try {
    return {
      success: !0,
      samples: (await Fn(e)).samples.map((r) => ({
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
function Kr() {
  try {
    if (N.isPackaged) {
      const t = S.join(process.resourcesPath, "assets");
      return Le(`${t}${S.sep}`).toString();
    }
    const e = S.join(N.getAppPath(), "public", "assets");
    return Le(`${e}${S.sep}`).toString();
  } catch (e) {
    return console.error("Failed to resolve asset base path:", e), null;
  }
}
function pr() {
  const e = G.getCursorScreenPoint(), t = Number(Z?.display_id);
  return ((Number.isFinite(t) ? G.getAllDisplays().find((n) => n.id === t) ?? null : null) ?? G.getDisplayNearestPoint(e)).bounds;
}
function Rs() {
  return typeof Z?.id == "string" ? Z.id : null;
}
function Yr() {
  const e = Number(Z?.display_id);
  return Number.isFinite(e) ? G.getAllDisplays().find((t) => t.id === e) ?? null : null;
}
function yt(...e) {
  const t = S.join(N.getAppPath(), ...e);
  return N.isPackaged ? t.replace(/\.asar([/\\])/, ".asar.unpacked$1") : t;
}
function Dn(...e) {
  return N.isPackaged ? S.join(process.resourcesPath, ...e) : null;
}
function Ns() {
  const e = process.env.OPENSCREEN_WGC_CAPTURE_EXE?.trim(), t = process.arch === "arm64" ? "win32-arm64" : "win32-x64";
  return [
    e,
    yt(
      "electron",
      "native",
      "wgc-capture",
      "build",
      "Release",
      "wgc-capture.exe"
    ),
    yt("electron", "native", "wgc-capture", "build", "wgc-capture.exe"),
    yt("electron", "native", "bin", t, "wgc-capture.exe"),
    Dn("electron", "native", "bin", t, "wgc-capture.exe")
  ].filter((r) => !!r);
}
async function Jr() {
  if (process.platform !== "win32")
    return null;
  for (const e of Ns())
    try {
      return await D.access(e, gt.X_OK), e;
    } catch {
    }
  return null;
}
function Vs() {
  const e = process.env.OPENSCREEN_SCK_CAPTURE_EXE?.trim(), t = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64", r = "openscreen-screencapturekit-helper";
  return [
    e,
    yt("electron", "native", "screencapturekit", "build", r),
    yt("electron", "native", "bin", t, r),
    Dn("electron", "native", "bin", t, r)
  ].filter((n) => !!n);
}
async function Zt() {
  if (process.platform !== "darwin")
    return null;
  for (const e of Vs())
    try {
      return await D.access(e, gt.X_OK), e;
    } catch {
    }
  return null;
}
function Qt() {
  if (process.platform !== "darwin")
    return !1;
  const [e] = process.getSystemVersion().split(".").map(Number);
  return Number.isFinite(e) && e >= 15;
}
function Xr() {
  if (process.platform !== "win32")
    return !1;
  const [, , e] = process.getSystemVersion().split(".").map(Number);
  return Number.isFinite(e) && e >= 19041;
}
function er(e) {
  return e.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function Bs(e, t, r) {
  const n = er(e), a = er(t), s = er(r ?? "");
  return s ? n === s ? 1e3 : n.includes(s) || s.includes(n) ? 900 : a.includes(s) || s.includes(a) ? 800 : s.split(/\s+/).filter((p) => p.length > 1 && !["camera", "webcam", "video", "input"].includes(p)).reduce((p, m) => n.includes(m) ? p + 100 : a.includes(m) ? p + 50 : p, 0) : 0;
}
function zs() {
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
async function Us(e) {
  if (process.platform !== "win32" || !e?.trim())
    return null;
  const t = await zs();
  let r = {};
  const n = [];
  for (const s of t.split(/\r?\n/)) {
    const p = s.trim();
    if (!p) continue;
    if (/^HKEY_/i.test(p)) {
      (r.friendlyName || r.clsid) && n.push(r), r = {};
      continue;
    }
    const m = p.match(/^(\S+)\s+REG_SZ\s+(.+)$/);
    m && (m[1] === "FriendlyName" && (r.friendlyName = m[2].trim()), m[1] === "CLSID" && (r.clsid = m[2].trim()));
  }
  (r.friendlyName || r.clsid) && n.push(r);
  let a = null;
  for (const s of n) {
    if (!s.clsid) continue;
    const p = Bs(s.friendlyName ?? "", s.clsid, e);
    (!a || p > a.score) && (a = { clsid: s.clsid, friendlyName: s.friendlyName, score: p });
  }
  return !a || a.score <= 0 ? null : (console.info("[native-wgc] resolved DirectShow webcam filter", {
    requestedName: e,
    filterName: a.friendlyName,
    clsid: a.clsid,
    score: a.score
  }), a.clsid);
}
async function tr(e) {
  ce && (W = await ce.stop(), ce = null), W = null, ce = es({
    getDisplayBounds: pr,
    maxSamples: _s,
    platform: process.platform,
    sampleIntervalMs: Is,
    sourceId: Rs(),
    startTimeMs: typeof e == "number" && Number.isFinite(e) ? e : void 0
  });
  try {
    await ce.start();
  } catch (t) {
    console.error("Failed to start cursor recording session:", t), ce = null;
  }
}
async function je() {
  if (ce)
    try {
      W = await ce.stop();
    } catch (e) {
      console.error("Failed to stop cursor recording session:", e), W = null;
    } finally {
      ce = null;
    }
}
async function rr(e) {
  const t = `${e}.cursor.json`;
  W && W.samples.length > 0 && await D.writeFile(t, JSON.stringify(W, null, 2), "utf-8"), W = null;
}
function qr(e) {
  !W || !Number.isFinite(e) || e <= 0 || (W = {
    ...W,
    samples: W.samples.map((t) => ({
      ...t,
      timeMs: Math.max(0, t.timeMs - e)
    })).sort((t, r) => t.timeMs - r.timeMs)
  });
}
function Zr(e) {
  if (!W || e.length === 0)
    return;
  const t = e.map((r) => ({
    startMs: Math.max(0, Math.min(r.startMs, r.endMs)),
    endMs: Math.max(0, Math.max(r.startMs, r.endMs))
  })).filter((r) => Number.isFinite(r.startMs) && Number.isFinite(r.endMs)).filter((r) => r.endMs > r.startMs).sort((r, n) => r.startMs - n.startMs);
  t.length !== 0 && (W = {
    ...W,
    samples: W.samples.map((r) => {
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
function Qr(e = Date.now()) {
  Re === null || ke <= 0 || (mt.push({
    startMs: Math.max(0, Re - ke),
    endMs: Math.max(0, e - ke)
  }), Re = null);
}
function en(e = Date.now()) {
  Me === null || Ee <= 0 || (pt.push({
    startMs: Math.max(0, Me - Ee),
    endMs: Math.max(0, e - Ee)
  }), Me = null);
}
function Ws(e) {
  return new Promise((t, r) => {
    const n = setTimeout(() => {
      m(), r(new Error("Timed out waiting for native Windows capture to start"));
    }, 12e3), a = (f) => {
      ue += f.toString(), ue.includes("Recording started") && (m(), t());
    }, s = (f) => {
      m(), r(f);
    }, p = (f) => {
      m(), r(
        new Error(
          ue.trim() || `Native Windows capture exited before recording started (code=${f ?? "unknown"})`
        )
      );
    }, m = () => {
      clearTimeout(n), e.stdout.off("data", a), e.stderr.off("data", a), e.off("error", s), e.off("exit", p);
    };
    e.stdout.on("data", a), e.stderr.on("data", a), e.once("error", s), e.once("exit", p);
  });
}
function Ls(e) {
  return new Promise((t, r) => {
    const n = setTimeout(() => {
      m(), e.killed || e.kill(), r(
        new Error(
          `Timed out waiting for native Windows capture to stop. Output path: ${_e ?? "unknown"}. Output: ${ue.trim()}`
        )
      );
    }, Es), a = (f) => {
      ue += f.toString();
    }, s = (f) => {
      m();
      const b = ue.match(/Recording stopped\. Output path: (.+)/);
      if (b?.[1]) {
        t(b[1].trim());
        return;
      }
      if (f === 0 && _e) {
        t(_e);
        return;
      }
      r(
        new Error(
          ue.trim() || `Native Windows capture exited with code=${f ?? "unknown"}`
        )
      );
    }, p = (f) => {
      m(), r(f);
    }, m = () => {
      clearTimeout(n), e.stdout.off("data", a), e.stderr.off("data", a), e.off("close", s), e.off("error", p);
    };
    e.stdout.on("data", a), e.stderr.on("data", a), e.once("close", s), e.once("error", p);
  });
}
function $s(e) {
  const r = e.split(/\r?\n/).filter((n) => n.includes('"event":"webcam-format"')).at(-1);
  if (!r)
    return null;
  try {
    return JSON.parse(r);
  } catch {
    return null;
  }
}
function An(e) {
  try {
    const t = JSON.parse(e);
    return t && typeof t == "object" ? t : null;
  } catch {
    return null;
  }
}
function On() {
  for (const e of $e.split(/\r?\n/)) {
    const t = An(e.trim());
    t && Te.emit("helper-event", t);
  }
}
function Gs(e) {
  let t = "";
  const r = (a) => {
    const s = a.toString();
    $e += s, t += s;
    const p = t.split(/\r?\n/);
    t = p.pop() ?? "";
    for (const m of p) {
      const f = An(m.trim());
      f && (f.event === "recording-diagnostics" && console.info("[native-sck] recording diagnostics", f), Te.emit("helper-event", f));
    }
  }, n = () => {
    e.stdout.off("data", r), e.stderr.off("data", r), e.off("close", n), e.off("error", n);
  };
  e.stdout.on("data", r), e.stderr.on("data", r), e.once("close", n), e.once("error", n);
}
function Hs(e) {
  return new Promise((t, r) => {
    const n = setTimeout(() => {
      f(), r(new Error("Timed out waiting for native macOS capture to start"));
    }, 1e4), a = (b) => {
      if (b.event === "recording-started") {
        f(), t();
        return;
      }
      b.event === "error" && (f(), r(new Error(String(b.message ?? b.code ?? "Native macOS capture failed"))));
    }, s = (b) => a(b), p = (b) => {
      f(), r(
        new Error(
          $e.trim() || `Native macOS capture exited before recording started (code=${b ?? "unknown"})`
        )
      );
    }, m = (b) => {
      f(), r(b);
    }, f = () => {
      clearTimeout(n), Te.off("helper-event", s), e.off("close", p), e.off("error", m);
    };
    Te.on("helper-event", s), e.once("close", p), e.once("error", m), On();
  });
}
function tn(e, t, r = 3e4) {
  return new Promise((n, a) => {
    const s = setTimeout(() => {
      b(), a(new Error(`Timed out waiting for native macOS ${t}`));
    }, r), p = (F) => {
      if (F.event === t) {
        b(), n();
        return;
      }
      F.event === "error" && (b(), a(new Error(String(F.message ?? F.code ?? "Native macOS capture failed"))));
    }, m = (F) => {
      b(), a(new Error(`Native macOS capture exited during ${t} (code=${F})`));
    }, f = (F) => {
      b(), a(F);
    }, b = () => {
      clearTimeout(s), Te.off("helper-event", p), e.off("close", m), e.off("error", f);
    };
    Te.on("helper-event", p), e.once("close", m), e.once("error", f);
  });
}
function Ks(e) {
  return new Promise((t, r) => {
    const n = setTimeout(() => {
      f(), r(
        new Error(
          `Timed out waiting for native macOS capture to stop. Output path: ${ve ?? "unknown"}. Output: ${$e.trim()}`
        )
      );
    }, 12e4), a = (b) => {
      if (b.event === "recording-stopped") {
        f(), t(String(b.screenPath ?? ve ?? ""));
        return;
      }
      b.event === "error" && (f(), r(new Error(String(b.message ?? b.code ?? "Native macOS capture failed"))));
    }, s = (b) => a(b), p = (b) => {
      if (b === 0 && ve) {
        f(), t(ve);
        return;
      }
      f(), r(
        new Error(
          $e.trim() || `Native macOS capture exited with code=${b ?? "unknown"}`
        )
      );
    }, m = (b) => {
      f(), r(b);
    }, f = () => {
      clearTimeout(n), Te.off("helper-event", s), e.off("close", p), e.off("error", m);
    };
    Te.on("helper-event", s), e.once("close", p), e.once("error", m), On();
  });
}
function ne(e) {
  ie = e, he = e?.screenVideoPath ?? null;
}
function Ys(e) {
  const t = S.parse(e), r = t.name.endsWith("-webcam") ? t.name.slice(0, -7) : t.name;
  return S.join(t.dir, `${r}${We}`);
}
async function rn(e) {
  try {
    const t = Ys(e);
    if (!Pe(t)) {
      const m = S.parse(e);
      if (!Ut(S.resolve(t), m.dir))
        return null;
    }
    const r = await D.readFile(t, "utf-8"), n = dn(JSON.parse(r));
    if (!n)
      return null;
    const a = ht(e), s = ht(n.screenVideoPath) === a, p = typeof n.webcamVideoPath == "string" && ht(n.webcamVideoPath) === a;
    if (!s && !p)
      return null;
    if (!Pe(n.screenVideoPath)) {
      const m = await le(n.screenVideoPath, [
        S.dirname(t),
        R
      ]);
      if (!m)
        return null;
      n.screenVideoPath = m;
    }
    if (n.webcamVideoPath && !Pe(n.webcamVideoPath)) {
      const m = await le(n.webcamVideoPath, [
        S.dirname(t),
        R
      ]);
      m ? n.webcamVideoPath = m : n.webcamVideoPath = void 0;
    }
    return Nt(n.screenVideoPath), n.webcamVideoPath && Nt(n.webcamVideoPath), n;
  } catch (t) {
    return t.code !== "ENOENT" && console.error("Failed to restore recording session manifest:", t), null;
  }
}
function Js(e, t, r, n, a, s, p, m, f) {
  async function b() {
    if (process.platform !== "darwin")
      return { success: !0, granted: !0, status: "granted" };
    try {
      const l = ge.getMediaAccessStatus("screen");
      if (l === "granted")
        return { success: !0, granted: !0, status: l };
      if (l === "not-determined") {
        const o = n();
        return o && !o.isDestroyed() && (o.isVisible() || o.show(), o.focus()), N.focus({ steal: !0 }), St.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } }).catch(() => {
        }), { success: !0, granted: !1, status: "not-determined" };
      }
      return { success: !0, granted: !1, status: l };
    } catch (l) {
      return console.error("Failed to request screen access:", l), { success: !1, granted: !1, status: "unknown", error: String(l) };
    }
  }
  C.handle("get-sources", async (l, o) => {
    const i = await St.getSources(o);
    return Dt = new Map(i.map((c) => [c.id, c])), i.map((c) => ({
      id: c.id,
      name: c.name,
      display_id: c.display_id,
      thumbnail: c.thumbnail ? c.thumbnail.toDataURL() : null,
      appIcon: c.appIcon ? c.appIcon.toDataURL() : null
    }));
  }), C.handle("list-native-windows", async () => {
    try {
      if (process.platform !== "darwin" || !Qt())
        return { success: !0, windows: [] };
      const l = await Zt();
      if (!l) return { success: !0, windows: [] };
      const o = await D.mkdtemp(S.join(Pt.tmpdir(), "openscreen-native-windows-"));
      try {
        const i = Date.now(), c = await Bt(l, ["list-windows", o], {
          timeoutMs: 2e4
        });
        if (c.code !== 0) {
          const v = c.timedOut ? "Timed out enumerating windows" : c.stderr || c.stdout || "Failed to enumerate windows";
          return console.warn(`list-native-windows helper failed (code ${c.code}): ${v}`), { success: !1, message: v };
        }
        let w = [];
        for (const v of c.stdout.split(`
`))
          if (v.trim())
            try {
              const g = JSON.parse(v);
              g?.event === "windows" && Array.isArray(g.windows) && (w = g.windows);
            } catch {
            }
        return console.log(
          `list-native-windows: ${w.length} windows in ${Date.now() - i}ms`
        ), { success: !0, windows: await Promise.all(
          w.filter((v) => typeof v.windowId == "number").map(async (v) => {
            let g = null;
            if (typeof v.thumbnailPath == "string")
              try {
                g = `data:image/png;base64,${(await D.readFile(v.thumbnailPath)).toString("base64")}`;
              } catch {
              }
            const A = String(v.title ?? ""), O = String(v.appName ?? "");
            return {
              // Same id shape Electron's desktopCapturer uses, so the native
              // recording path parses the windowId without special-casing.
              id: `window:${v.windowId}:0`,
              windowId: Number(v.windowId),
              name: [O, A].filter(Boolean).join(" — ") || A || O,
              appName: O,
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
  }), C.handle("select-source", async (l, o) => {
    if (Z = o, dt = typeof o.id == "string" ? Dt.get(o.id) ?? null : null, !dt && typeof o.id == "string")
      try {
        const c = await St.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: !0
        });
        Dt = new Map(c.map((w) => [w.id, w])), dt = Dt.get(o.id) ?? null;
      } catch {
        dt = null;
      }
    const i = a();
    return i && i.close(), Z;
  }), C.handle("get-selected-source", () => Z), C.handle("request-camera-access", async () => {
    if (process.platform !== "darwin")
      return { success: !0, granted: !0, status: "granted" };
    try {
      const l = ge.getMediaAccessStatus("camera");
      if (l === "granted")
        return { success: !0, granted: !0, status: l };
      if (l === "not-determined") {
        const o = await ge.askForMediaAccess("camera");
        return {
          success: !0,
          granted: o,
          status: o ? "granted" : ge.getMediaAccessStatus("camera")
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
  }), C.handle("request-screen-access", async () => b()), C.handle("request-native-mac-cursor-access", async () => await Ha()), C.handle("open-source-selector", async () => {
    const l = await b();
    if (!l.granted) {
      if (process.platform === "darwin" && l.status !== "not-determined") {
        const i = n(), c = {
          type: "warning",
          buttons: ["Open System Settings", "Cancel"],
          defaultId: 0,
          cancelId: 1,
          message: "Screen Recording permission is required",
          detail: "Allow OpenScreen in macOS System Settings, then come back and choose a screen or window."
        };
        (i && !i.isDestroyed() ? await De.showMessageBox(i, c) : await De.showMessageBox(c)).response === 0 && await bt.openExternal(
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
  }), C.handle("switch-to-editor", () => {
    e();
  }), C.handle("switch-to-hud", () => (m?.(), { success: !0 })), C.handle("start-new-recording", () => (m?.(), { success: !0 })), C.handle("countdown-overlay-show", async (l, o, i) => {
    const c = s?.() ?? r();
    c.isDestroyed() || (c.webContents.isLoading() && await new Promise((w) => {
      c.once("ready-to-show", w);
    }), c.isVisible() || c.showInactive(), c.webContents.send("countdown-overlay-value", o, i));
  }), C.handle("countdown-overlay-set-value", (l, o, i) => {
    const c = s?.();
    !c || c.isDestroyed() || c.webContents.send("countdown-overlay-value", o, i);
  }), C.handle("countdown-overlay-hide", (l, o) => {
    const i = s?.();
    !i || i.isDestroyed() || (i.webContents.send("countdown-overlay-value", null, o), i.hide());
  }), C.handle("is-native-windows-capture-available", async () => {
    if (!Xr())
      return { success: !0, available: !1, reason: "unsupported-os" };
    const l = await Jr();
    return l ? { success: !0, available: !0, helperPath: l } : { success: !0, available: !1, reason: "missing-helper" };
  }), C.handle("is-native-mac-capture-available", async () => {
    if (!Qt())
      return { success: !0, available: !1, reason: "unsupported-platform" };
    const l = await Zt();
    return l ? { success: !0, available: !0, helperPath: l } : { success: !0, available: !1, reason: "missing-helper" };
  }), C.handle(
    "start-native-windows-recording",
    async (l, o) => {
      try {
        if (!Xr())
          return {
            success: !1,
            error: "Windows Graphics Capture requires Windows 10 build 19041 or newer."
          };
        if (me)
          return { success: !1, error: "Native Windows capture is already running." };
        const i = await Jr();
        if (!i)
          return { success: !1, error: "Native Windows capture helper is not available." };
        if (!o?.source?.sourceId)
          return {
            success: !1,
            error: "Native Windows capture request is missing a source."
          };
        const c = typeof o.recordingId == "number" && Number.isFinite(o.recordingId) ? o.recordingId : Date.now(), w = S.join(R, `${xt}${c}.mp4`), P = S.join(
          R,
          `${xt}${c}-webcam.mp4`
        ), v = o.source.type === "display" && typeof o.source.displayId == "number" ? G.getAllDisplays().find((u) => u.id === o.source.displayId) ?? null : Yr(), g = v?.bounds ?? pr(), A = typeof o.source.displayId == "number" && Number.isFinite(o.source.displayId) ? o.source.displayId : Number(Z?.display_id), O = o.webcam.enabled ? await Us(o.webcam.deviceName) : null, M = Ue(o.cursor?.mode) ?? "editable-overlay", B = {
          schemaVersion: 2,
          recordingId: c,
          outputPath: w,
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
          webcamDirectShowClsid: O,
          webcamWidth: o.webcam.width,
          webcamHeight: o.webcam.height,
          webcamFps: o.webcam.fps,
          captureCursor: M === "system",
          cursorCaptureMode: M,
          outputs: {
            screenPath: w,
            webcamPath: P
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
            mode: M
          }
        };
        console.info("[native-wgc] starting Windows capture", {
          helperPath: i,
          source: o.source,
          audio: o.audio,
          webcam: o.webcam,
          cursor: { mode: M },
          bounds: g,
          sourceId: Z?.id ?? null,
          usedDisplayMatch: !!v,
          outputPath: w
        }), await D.mkdir(R, { recursive: !0 }), ue = "", _e = w, At = o.webcam.enabled ? P : null, Ot = c, ze = 0, jt = M, Ee = 0, Me = null, pt = [], Ae = !1;
        const j = Date.now();
        M === "editable-overlay" ? (Ee = j, await tr(j), console.info("[native-wgc] cursor sampler ready", {
          cursorStartTimeMs: j,
          warmupMs: Date.now() - j
        })) : W = null;
        const J = Ve(i, [JSON.stringify(B)], {
          cwd: R,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: !0
        });
        me = J, await Ws(J);
        const Ce = Date.now();
        ze = M === "editable-overlay" ? Math.max(0, Ce - j) : 0;
        const ae = $s(ue);
        return console.info("[native-wgc] capture started", {
          captureStartedAtMs: Ce,
          cursorOffsetMs: ze,
          webcamFormat: ae
        }), p && p(!0, (Z || { name: "Screen" }).name), {
          success: !0,
          recordingId: c,
          path: w,
          helperPath: i
        };
      } catch (i) {
        return console.error("Failed to start native Windows recording:", i), me?.kill(), me = null, _e = null, At = null, Ot = null, ze = 0, jt = "editable-overlay", Ee = 0, Me = null, pt = [], Ae = !1, await je(), { success: !1, error: String(i) };
      }
    }
  ), C.handle("start-native-mac-recording", async (l, o) => {
    try {
      if (!Qt())
        return { success: !1, error: "Native macOS capture requires macOS 15 or newer." };
      if (fe)
        return { success: !1, error: "Native macOS capture is already running." };
      const i = await Zt();
      if (!i)
        return { success: !1, error: "Native macOS capture helper is not available." };
      if (!o?.source?.sourceId)
        return { success: !1, error: "Native macOS capture request is missing a source." };
      const c = typeof o.recordingId == "number" && Number.isFinite(o.recordingId) ? o.recordingId : Date.now(), w = S.join(R, `${xt}${c}.mp4`), P = Ue(o.cursor?.mode) ?? "editable-overlay";
      try {
        await St.getSources({
          types: ["screen"],
          thumbnailSize: { width: 1, height: 1 }
        });
      } catch {
      }
      o.audio?.microphone?.enabled && ge.getMediaAccessStatus("microphone") !== "granted" && await ge.askForMediaAccess("microphone");
      const v = o.source.type === "display" && typeof o.source.displayId == "number" ? G.getAllDisplays().find((J) => J.id === o.source.displayId) ?? null : Yr(), g = o.source.bounds ?? v?.bounds ?? pr(), A = {
        ...o,
        schemaVersion: 1,
        recordingId: c,
        source: {
          ...o.source,
          excludedWindowIds: Array.from(
            new Set(
              (f?.() ?? []).filter(
                (J) => Number.isSafeInteger(J) && J > 0
              )
            )
          ),
          bounds: g
        },
        video: {
          ...o.video,
          hideSystemCursor: P === "editable-overlay"
        },
        webcam: {
          ...o.webcam,
          enabled: !1
        },
        cursor: {
          mode: P
        },
        outputs: {
          screenPath: w,
          manifestPath: S.join(
            R,
            `${xt}${c}${We}`
          )
        }
      };
      console.info("[native-sck] starting macOS capture", {
        helperPath: i,
        source: A.source,
        audio: A.audio,
        webcam: A.webcam,
        cursor: A.cursor,
        outputPath: w
      }), await D.mkdir(R, { recursive: !0 }), $e = "", ve = w, It = c, _t = [
        ...A.audio?.system?.enabled ? ["system"] : [],
        ...A.audio?.microphone?.enabled ? ["microphone"] : []
      ], ut = 0, Et = P, ke = 0, Re = null, mt = [], Oe = !1;
      const O = Date.now();
      P === "editable-overlay" ? (ke = O, await tr(O)) : W = null;
      const M = Ve(i, [JSON.stringify(A)], {
        cwd: R,
        stdio: ["pipe", "pipe", "pipe"]
      });
      fe = M, Gs(M), await Hs(M);
      const B = Date.now();
      return ut = P === "editable-overlay" ? Math.max(0, B - O) : 0, p && p(!0, (Z || { name: "Screen" }).name), {
        success: !0,
        recordingId: c,
        path: w,
        helperPath: i
      };
    } catch (i) {
      return console.error("Failed to start native macOS recording:", i), fe?.kill(), fe = null, ve = null, It = null, _t = null, ut = 0, Et = "editable-overlay", ke = 0, Re = null, mt = [], Oe = !1, await je(), { success: !1, error: i instanceof Error ? i.message : String(i) };
    }
  }), C.handle("pause-native-mac-recording", async () => {
    if (process.platform !== "darwin")
      return { success: !1, error: "Native macOS capture requires macOS." };
    const l = fe;
    if (!l)
      return { success: !1, error: "Native macOS capture is not running." };
    if (Oe)
      return { success: !0 };
    if (!l.stdin.writable)
      return { success: !1, error: "Native macOS capture command channel is closed." };
    try {
      const o = tn(l, "recording-paused");
      return l.stdin.write(`pause
`), await o, Oe = !0, Re = Date.now(), { success: !0 };
    } catch (o) {
      return { success: !1, error: o instanceof Error ? o.message : String(o) };
    }
  }), C.handle("resume-native-mac-recording", async () => {
    if (process.platform !== "darwin")
      return { success: !1, error: "Native macOS capture requires macOS." };
    const l = fe;
    if (!l)
      return { success: !1, error: "Native macOS capture is not running." };
    if (!Oe)
      return { success: !0 };
    if (!l.stdin.writable)
      return { success: !1, error: "Native macOS capture command channel is closed." };
    try {
      const o = tn(l, "recording-resumed");
      return l.stdin.write(`resume
`), await o, Qr(), Oe = !1, { success: !0 };
    } catch (o) {
      return { success: !1, error: o instanceof Error ? o.message : String(o) };
    }
  }), C.handle("pause-native-windows-recording", async () => {
    const l = me;
    if (!l)
      return { success: !1, error: "Native Windows capture is not running." };
    if (Ae)
      return { success: !0 };
    if (!l.stdin.writable)
      return { success: !1, error: "Native Windows capture command channel is closed." };
    try {
      return l.stdin.write(`pause
`), Ae = !0, Me = Date.now(), { success: !0 };
    } catch (o) {
      return { success: !1, error: o instanceof Error ? o.message : String(o) };
    }
  }), C.handle("resume-native-windows-recording", async () => {
    const l = me;
    if (!l)
      return { success: !1, error: "Native Windows capture is not running." };
    if (!Ae)
      return { success: !0 };
    if (!l.stdin.writable)
      return { success: !1, error: "Native Windows capture command channel is closed." };
    try {
      return l.stdin.write(`resume
`), en(), Ae = !1, { success: !0 };
    } catch (o) {
      return { success: !1, error: o instanceof Error ? o.message : String(o) };
    }
  }), C.handle("stop-native-windows-recording", async (l, o) => {
    const i = me, c = _e, w = At, P = Ot ?? Date.now(), v = jt;
    if (!i)
      return { success: !1, error: "Native Windows capture is not running." };
    try {
      en();
      const g = Ls(i);
      i.stdin.write(`stop
`);
      const O = await g || c;
      if (!O)
        throw new Error("Native Windows capture did not return an output path.");
      if (v === "editable-overlay" ? await je() : W = null, o)
        return W = null, await Promise.all([
          D.rm(O, { force: !0 }),
          w ? D.rm(w, { force: !0 }) : Promise.resolve(),
          D.rm(`${O}.cursor.json`, { force: !0 })
        ]), { success: !0, discarded: !0 };
      v === "editable-overlay" && (Zr(pt), qr(ze), await rr(O));
      let M;
      if (w)
        try {
          await D.access(w, gt.R_OK), M = w;
        } catch {
          M = void 0;
        }
      const B = M ? { screenVideoPath: O, webcamVideoPath: M, createdAt: P, cursorCaptureMode: v } : { screenVideoPath: O, createdAt: P, cursorCaptureMode: v };
      ne(B), H = null;
      const j = S.join(
        R,
        `${S.parse(O).name}${We}`
      );
      return await D.writeFile(j, JSON.stringify(B, null, 2), "utf-8"), {
        success: !0,
        path: O,
        session: B,
        message: "Native Windows recording session stored successfully"
      };
    } catch (g) {
      return console.error("Failed to stop native Windows recording:", g), await je(), { success: !1, error: String(g) };
    } finally {
      me = null, _e = null, At = null, Ot = null, ze = 0, jt = "editable-overlay", Ee = 0, Me = null, pt = [], Ae = !1, p && p(!1, (Z || { name: "Screen" }).name);
    }
  }), C.handle("stop-native-mac-recording", async (l, o) => {
    if (process.platform !== "darwin")
      return { success: !1, error: "Native macOS capture requires macOS." };
    const i = fe, c = ve, w = It ?? Date.now(), P = Et, v = _t;
    if (!i)
      return { success: !1, error: "Native macOS capture is not running." };
    try {
      Qr();
      const g = Ks(i);
      i.stdin.write(`stop
`);
      const O = await g || c;
      if (!O)
        throw new Error("Native macOS capture did not return an output path.");
      if (P === "editable-overlay" ? await je() : W = null, o)
        return W = null, await Promise.all([
          D.rm(O, { force: !0 }),
          D.rm(`${O}.cursor.json`, { force: !0 }),
          D.rm(`${O}.diagnostics.json`, { force: !0 })
        ]), { success: !0, discarded: !0 };
      P === "editable-overlay" && (Zr(mt), qr(ut), await rr(O));
      const M = {
        screenVideoPath: O,
        createdAt: w,
        cursorCaptureMode: P,
        ...v?.length ? { audioStreams: v } : {}
      };
      ne(M), H = null;
      const B = S.join(
        R,
        `${S.parse(O).name}${We}`
      );
      return await D.writeFile(B, JSON.stringify(M, null, 2), "utf-8"), {
        success: !0,
        path: O,
        session: M,
        message: "Native macOS recording session stored successfully"
      };
    } catch (g) {
      return console.error("Failed to stop native macOS recording:", g), await je(), { success: !1, error: g instanceof Error ? g.message : String(g) };
    } finally {
      fe = null, ve = null, It = null, _t = null, ut = 0, Et = "editable-overlay", ke = 0, Re = null, mt = [], Oe = !1, p && p(!1, (Z || { name: "Screen" }).name);
    }
  }), C.handle(
    "attach-native-mac-webcam-recording",
    async (l, o) => {
      try {
        if (process.platform !== "darwin")
          return { success: !1, error: "Native macOS webcam attachment requires macOS." };
        const i = we(o.screenVideoPath);
        if (!i || !Ut(i, R))
          return {
            success: !1,
            error: "Native macOS webcam attachment requires a recording output path."
          };
        if (await D.access(i, gt.R_OK), !o.webcam?.fileName || !o.webcam.videoData)
          return { success: !1, error: "Native macOS webcam attachment is missing video data." };
        const c = Ft(o.webcam.fileName);
        await D.writeFile(c, Buffer.from(o.webcam.videoData));
        const w = typeof o.recordingId == "number" && Number.isFinite(o.recordingId) ? o.recordingId : Date.now(), P = Ue(o.cursorCaptureMode), g = (ie?.screenVideoPath === i ? ie : await rn(i))?.audioStreams, A = {
          screenVideoPath: i,
          webcamVideoPath: c,
          createdAt: w,
          ...P ? { cursorCaptureMode: P } : {},
          ...g?.length ? { audioStreams: g } : {}
        };
        ne(A), H = null;
        const O = S.join(
          R,
          `${S.parse(i).name}${We}`
        );
        return await D.writeFile(O, JSON.stringify(A, null, 2), "utf-8"), {
          success: !0,
          path: i,
          session: A,
          message: "Native macOS webcam recording attached successfully"
        };
      } catch (i) {
        return console.error("Failed to attach native macOS webcam recording:", i), {
          success: !1,
          error: i instanceof Error ? i.message : String(i)
        };
      }
    }
  );
  const F = new gs();
  ws(C, F, Ft), C.handle("store-recorded-session", async (l, o) => {
    try {
      return await k(o);
    } catch (i) {
      return console.error("Failed to store recording session:", i), {
        success: !1,
        message: "Failed to store recording session",
        error: String(i)
      };
    }
  });
  async function k(l) {
    const o = typeof l.createdAt == "number" && Number.isFinite(l.createdAt) ? l.createdAt : Date.now(), i = Ue(l.cursorCaptureMode), c = Ft(l.screen.fileName), w = await Gr(
      F,
      l.screen.fileName,
      c,
      l.screen.videoData
    );
    let P, v = !1;
    if (l.webcam && (P = Ft(l.webcam.fileName), v = await Gr(
      F,
      l.webcam.fileName,
      P,
      l.webcam.videoData
    )), Ds(l.durationMs)) {
      const O = [];
      w && O.push(Lr(c, l.durationMs)), v && P && O.push(Lr(P, l.durationMs)), await Promise.all(O);
    }
    const g = P ? {
      screenVideoPath: c,
      webcamVideoPath: P,
      createdAt: o,
      ...i ? { cursorCaptureMode: i } : {}
    } : { screenVideoPath: c, createdAt: o, ...i ? { cursorCaptureMode: i } : {} };
    ne(g), H = null, await rr(c);
    const A = S.join(
      R,
      `${S.parse(l.screen.fileName).name}${We}`
    );
    return await D.writeFile(A, JSON.stringify(g, null, 2), "utf-8"), {
      success: !0,
      path: c,
      session: g,
      message: "Recording session stored successfully"
    };
  }
  C.handle("store-recorded-video", async (l, o, i) => {
    try {
      return await k({
        screen: { videoData: o, fileName: i },
        createdAt: Date.now()
      });
    } catch (c) {
      return console.error("Failed to store recorded video:", c), {
        success: !1,
        message: "Failed to store recorded video",
        error: String(c)
      };
    }
  }), C.handle("get-recorded-video-path", async () => {
    try {
      if (ie?.screenVideoPath)
        return { success: !0, path: ie.screenVideoPath };
      const o = (await D.readdir(R)).filter(
        (w) => w.endsWith(".webm") && !w.endsWith("-webcam.webm")
      );
      if (o.length === 0)
        return { success: !1, message: "No recorded video found" };
      const i = o.sort().reverse()[0];
      return { success: !0, path: S.join(R, i) };
    } catch (l) {
      return console.error("Failed to get video path:", l), { success: !1, message: "Failed to get video path", error: String(l) };
    }
  }), C.handle(
    "set-recording-state",
    async (l, o, i, c) => {
      const w = Ue(c) ?? "editable-overlay";
      o && w === "editable-overlay" ? await tr(i) : await je(), p && p(o, (Z || { name: "Screen" }).name);
    }
  ), C.handle("get-cursor-telemetry", async (l, o) => {
    const i = Cs(
      o ?? ie?.screenVideoPath
    );
    return i ? Hr(i) : { success: !0, samples: [] };
  }), C.handle("open-external-url", async (l, o) => {
    try {
      return await bt.openExternal(o), { success: !0 };
    } catch (i) {
      return console.error("Failed to open URL:", i), { success: !1, error: String(i) };
    }
  }), C.handle("get-asset-base-path", () => Kr()), C.handle("pick-export-save-path", async (l, o, i) => {
    try {
      const c = o.toLowerCase().endsWith(".gif"), w = c ? [{ name: _("dialogs", "fileDialogs.gifImage"), extensions: ["gif"] }] : [{ name: _("dialogs", "fileDialogs.mp4Video"), extensions: ["mp4"] }];
      let P = N.getPath("downloads");
      if (i)
        try {
          (await D.stat(i)).isDirectory() && (P = i);
        } catch (A) {
          console.warn(
            `Could not access remembered export folder "${i}", falling back to Downloads:`,
            A
          );
        }
      const v = Ct(
        {
          title: c ? _("dialogs", "fileDialogs.saveGif") : _("dialogs", "fileDialogs.saveVideo"),
          defaultPath: S.join(P, o),
          filters: w,
          properties: ["createDirectory", "showOverwriteConfirmation"]
        },
        n()
      ), g = await De.showSaveDialog(v);
      return g.canceled || !g.filePath ? { success: !1, canceled: !0, message: "Export canceled" } : { success: !0, path: S.normalize(g.filePath) };
    } catch (c) {
      return console.error("Failed to show save dialog:", c), {
        success: !1,
        message: "Failed to show save dialog",
        error: String(c)
      };
    }
  }), C.handle("write-export-to-path", async (l, o, i) => {
    try {
      if (typeof i != "string" || !S.isAbsolute(i))
        return { success: !1, message: "Invalid path" };
      const c = i.toLowerCase();
      if (!c.endsWith(".mp4") && !c.endsWith(".gif"))
        return { success: !1, message: "Invalid file type" };
      const w = S.normalize(i);
      return await D.mkdir(S.dirname(w), { recursive: !0 }), await D.writeFile(w, Buffer.from(o)), {
        success: !0,
        path: w,
        message: "Video exported successfully"
      };
    } catch (c) {
      return console.error("Failed to write exported video:", c), {
        success: !1,
        message: "Failed to save exported video",
        error: String(c)
      };
    }
  }), C.handle("copy-export-source-to-path", async (l, o, i) => {
    try {
      const c = we(o);
      if (!c || !Pe(c) || typeof i != "string" || !S.isAbsolute(i) || !i.toLowerCase().endsWith(".mp4"))
        return { success: !1, message: "Invalid export path" };
      const w = S.normalize(i);
      return await D.mkdir(S.dirname(w), { recursive: !0 }), await D.copyFile(c, w), { success: !0, path: w, message: "Video copied successfully" };
    } catch (c) {
      return {
        success: !1,
        message: c instanceof Error ? c.message : String(c)
      };
    }
  }), C.handle("open-video-file-picker", async () => {
    try {
      const l = Ct(
        {
          title: _("dialogs", "fileDialogs.selectVideo"),
          defaultPath: R,
          filters: [
            {
              name: _("dialogs", "fileDialogs.videoFiles"),
              extensions: ["webm", "mp4", "mov", "avi", "mkv", "m4v", "wmv", "flv", "ts"]
            },
            { name: _("dialogs", "fileDialogs.allFiles"), extensions: ["*"] }
          ],
          properties: ["openFile"]
        },
        n()
      ), o = await De.showOpenDialog(l);
      if (o.canceled || o.filePaths.length === 0)
        return { success: !1, canceled: !0 };
      const i = await le(o.filePaths[0]);
      return i ? (H = null, {
        success: !0,
        path: i
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
  }), C.handle("reveal-in-folder", async (l, o) => {
    try {
      return bt.showItemInFolder(o), { success: !0 };
    } catch (i) {
      console.error(`Error revealing item in folder: ${o}`, i);
      try {
        const c = await bt.openPath(S.dirname(o));
        return c ? { success: !1, error: c } : { success: !0, message: "Could not reveal item, but opened directory." };
      } catch (c) {
        return console.error(`Error opening directory: ${S.dirname(o)}`, c), { success: !1, error: String(i) };
      }
    }
  }), C.handle("read-binary-file", async (l, o) => {
    try {
      const i = await le(o);
      if (!i)
        return {
          success: !1,
          message: "File path is not approved or is not a supported video file"
        };
      const c = await D.readFile(i);
      return {
        success: !0,
        data: c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength),
        path: i
      };
    } catch (i) {
      return console.error("Failed to read binary file:", i), {
        success: !1,
        message: "Failed to read binary file",
        error: String(i)
      };
    }
  }), C.handle("create-media-source-handle", async (l, o) => {
    const i = we(o);
    if (!i || !Pe(i))
      return { success: !1, message: "Source file is not approved" };
    try {
      const c = await D.stat(i), w = br(), P = await Ss();
      return Rt.set(w, {
        filePath: i,
        expiresAt: Date.now() + 1800 * 1e3
      }), {
        success: !0,
        id: w,
        url: `http://127.0.0.1:${P}/media/${w}`,
        size: c.size,
        mtimeMs: c.mtimeMs
      };
    } catch (c) {
      return { success: !1, message: c instanceof Error ? c.message : String(c) };
    }
  }), C.handle("release-media-source-handle", (l, o) => (Rt.delete(o), { success: !0 })), C.handle(
    "prepare-preview-audio-track",
    async (l, o, i) => {
      try {
        return await Fs(o, i);
      } catch (c) {
        return console.error("Failed to prepare preview audio track:", c), {
          success: !1,
          message: "Failed to prepare preview audio track",
          error: String(c)
        };
      }
    }
  ), C.handle("inspect-audio-tracks", async (l, o) => {
    try {
      const i = await le(o);
      if (!i) return { success: !1, message: "Source file is not approved" };
      if (process.platform !== "darwin" || S.extname(i).toLowerCase() !== ".mp4")
        return {
          success: !1,
          message: "Audio track inspection is only available for macOS MP4"
        };
      const c = await Bt("/usr/bin/afinfo", [i]);
      return c.code !== 0 ? { success: !1, message: c.stderr || "Unable to inspect audio tracks" } : {
        success: !0,
        tracks: Tn(`${c.stdout}
${c.stderr}`).map(
          (w, P) => ({ ordinal: P, bitRate: w })
        )
      };
    } catch (i) {
      return { success: !1, message: i instanceof Error ? i.message : String(i) };
    }
  }), C.handle(
    "save-project-file",
    async (l, o, i, c) => K(o, i, c)
  );
  async function K(l, o, i) {
    try {
      const c = Os(i) ? i : null;
      if (c)
        return await D.writeFile(
          c,
          JSON.stringify(l, null, 2),
          "utf-8"
        ), H = c, {
          success: !0,
          path: c,
          message: "Project saved successfully"
        };
      const w = (o || `project-${Date.now()}`).replace(/[^a-zA-Z0-9-_]/g, "_"), P = w.endsWith(`.${it}`) ? w : `${w}.${it}`, v = Ct(
        {
          title: _("dialogs", "fileDialogs.saveProject"),
          defaultPath: S.join(R, P),
          filters: [
            {
              name: _("dialogs", "fileDialogs.openscreenProject"),
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
      } : (await D.writeFile(g.filePath, JSON.stringify(l, null, 2), "utf-8"), H = g.filePath, {
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
  C.handle("load-project-file", async (l, o) => de(o));
  async function de(l) {
    try {
      let o = R;
      if (l)
        try {
          (await D.stat(l)).isDirectory() && (o = l);
        } catch (g) {
          console.warn(
            `Could not access remembered project folder "${l}", falling back to RECORDINGS_DIR:`,
            g
          );
        }
      const i = Ct(
        {
          title: _("dialogs", "fileDialogs.openProject"),
          defaultPath: o,
          filters: [
            {
              name: _("dialogs", "fileDialogs.openscreenProject"),
              extensions: [it]
            },
            { name: "JSON", extensions: ["json"] },
            { name: _("dialogs", "fileDialogs.allFiles"), extensions: ["*"] }
          ],
          properties: ["openFile"]
        },
        n()
      ), c = await De.showOpenDialog(i);
      if (c.canceled || c.filePaths.length === 0)
        return { success: !1, canceled: !0, message: "Open project canceled" };
      const w = c.filePaths[0], P = await D.readFile(w, "utf-8"), v = JSON.parse(P);
      return H = w, ne(await qt(v, w)), {
        success: !0,
        path: w,
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
  C.handle("load-project-file-from-path", async (l, o) => Q(o)), C.handle("list-media-library", async () => {
    try {
      const o = (await D.readdir(R, { withFileTypes: !0 })).filter(
        (c) => c.isFile() && (c.name.endsWith(".openscreen") || c.name.endsWith(".mp4"))
      );
      return {
        success: !0,
        items: (await Promise.all(
          o.map(async (c) => {
            const w = S.join(R, c.name);
            try {
              const P = await D.stat(w), v = c.name.replace(/\.openscreen$|\.mp4$/i, ""), g = c.name.endsWith(".openscreen"), A = S.join(R, `${v}.openscreen`), O = S.join(R, `${v}.session.json`), [M, B] = await Promise.all([
                g ? Promise.resolve(!0) : D.access(A).then(() => !0).catch(() => !1),
                D.access(O).then(() => !0).catch(() => !1)
              ]);
              return {
                path: w,
                kind: g ? "project" : "recording",
                title: v.replace(/^recording-/, "Recording "),
                modifiedAt: P.mtimeMs,
                fileSize: P.size,
                hasProject: M,
                hasSession: B
              };
            } catch {
              return null;
            }
          })
        )).filter((c) => c !== null).sort((c, w) => w.modifiedAt - c.modifiedAt)
      };
    } catch (l) {
      return {
        success: !1,
        items: [],
        message: l instanceof Error ? l.message : String(l)
      };
    }
  });
  async function Q(l) {
    try {
      if (!l || typeof l != "string")
        return { success: !1, message: "Invalid file path" };
      if (S.extname(l).toLowerCase() !== `.${it}`)
        return { success: !1, message: "Not an Openscreen project file" };
      if (!(await D.stat(l).catch(() => null))?.isFile())
        return { success: !1, message: "File not found" };
      const i = await D.readFile(l, "utf-8"), c = JSON.parse(i);
      H = l;
      let w = null;
      try {
        w = await qt(c, l);
      } catch (P) {
        console.warn(
          "[loadProjectFileFromPath] Could not approve session paths, proceeding without session:",
          P
        );
      }
      return ne(w), { success: !0, path: l, project: c };
    } catch (o) {
      return console.error("Failed to load project file from path:", o), {
        success: !1,
        message: "Failed to load project file",
        error: String(o)
      };
    }
  }
  C.handle("load-current-project-file", async () => oe());
  async function oe() {
    try {
      if (!H)
        return { success: !1, message: "No active project" };
      const l = await D.readFile(H, "utf-8"), o = JSON.parse(l);
      return ne(await qt(o, H)), {
        success: !0,
        path: H,
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
  C.handle("set-current-video-path", async (l, o) => ee(o)), C.handle("set-current-recording-session", (l, o) => {
    const i = dn(o);
    return ne(i), he = i?.screenVideoPath ?? null, H = null, { success: !0, session: ie };
  }), C.handle("get-current-recording-session", () => ie ? { success: !0, session: ie } : { success: !1 });
  async function ee(l) {
    const o = we(l);
    if (!o || !Pe(o))
      return {
        success: !1,
        message: "Video path has not been approved"
      };
    const i = await rn(o);
    return ne(i || {
      screenVideoPath: o,
      createdAt: Date.now()
    }), H = null, { success: !0, path: he ?? o };
  }
  C.handle("get-current-video-path", () => Ke());
  function Ke() {
    return he ? { success: !0, path: he } : { success: !1 };
  }
  C.handle("clear-current-video-path", () => Ye());
  function Ye() {
    return he = null, H = null, ne(null), { success: !0 };
  }
  C.handle("get-platform", () => process.platform), C.handle("get-shortcuts", async () => {
    try {
      const l = await D.readFile(lr, "utf-8");
      return JSON.parse(l);
    } catch {
      return null;
    }
  }), C.handle("save-shortcuts", async (l, o) => {
    try {
      return await D.writeFile(lr, JSON.stringify(o, null, 2), "utf-8"), { success: !0 };
    } catch (i) {
      return console.error("Failed to save shortcuts:", i), { success: !1, error: String(i) };
    }
  }), C.handle("openai-api-key-status", async () => ({
    configured: !!await lt(),
    secureStorageAvailable: Ie.isEncryptionAvailable()
  })), C.handle("openai-api-key-save", async (l, o) => {
    try {
      return await xs(o);
    } catch (i) {
      return { success: !1, message: i instanceof Error ? i.message : String(i) };
    }
  }), C.handle("openai-api-key-clear", async () => {
    try {
      return await D.rm(kt, { force: !0 }), await D.rm(vr, { force: !0 }), { success: !0 };
    } catch (l) {
      return { success: !1, message: l instanceof Error ? l.message : String(l) };
    }
  }), C.handle(
    "openai-whisper-transcribe",
    async (l, o) => {
      const i = await lt();
      if (!i)
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
      const c = new AbortController(), w = setTimeout(() => c.abort(), 12e4);
      try {
        const P = new FormData();
        P.append("file", new Blob([o.audio], { type: "audio/wav" }), "captions.wav"), P.append("model", "whisper-1"), P.append("response_format", "verbose_json"), P.append("timestamp_granularities[]", "word"), P.append("timestamp_granularities[]", "segment"), o.language && P.append("language", o.language);
        const v = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${i}` },
          body: P,
          signal: c.signal
        }), g = await v.json().catch(() => null);
        if (!v.ok) {
          const A = g && typeof g == "object" && "error" in g ? String(
            g.error?.message || v.statusText
          ) : v.statusText;
          return { success: !1, code: `HTTP_${v.status}`, message: A };
        }
        return { success: !0, data: g };
      } catch (P) {
        const v = P && typeof P == "object" && "cause" in P ? String(P.cause ?? "") : "", g = P instanceof Error ? P.message : String(P);
        return {
          success: !1,
          code: "NETWORK_ERROR",
          message: c.signal.aborted ? "OpenAI transcription timed out after 120 seconds. Check your network connection and try again." : `Could not reach OpenAI: ${g}${v ? ` (${v})` : ""}`
        };
      } finally {
        clearTimeout(w);
      }
    }
  );
  async function pe(l, o, i, c) {
    const w = new AbortController(), P = setTimeout(() => w.abort(), 6e4);
    try {
      const v = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${l}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          input: o,
          voice: i,
          response_format: "wav",
          ...c ? { instructions: c } : {}
        }),
        signal: w.signal
      });
      if (!v.ok) {
        const A = await v.json().catch(() => null), O = A && typeof A == "object" && "error" in A ? String(
          A.error?.message || v.statusText
        ) : v.statusText;
        return { success: !1, code: `HTTP_${v.status}`, message: O };
      }
      const g = await v.arrayBuffer();
      return g.byteLength === 0 ? { success: !1, code: "EMPTY_AUDIO", message: "OpenAI returned no audio." } : { success: !0, data: g, modelUsed: "gpt-4o-mini-tts" };
    } catch (v) {
      const g = v instanceof Error ? v.message : String(v);
      return {
        success: !1,
        code: "NETWORK_ERROR",
        message: w.signal.aborted ? "OpenAI speech synthesis timed out. Check your network connection and try again." : `Could not reach OpenAI: ${g}`
      };
    } finally {
      clearTimeout(P);
    }
  }
  async function vt(l, o, i, c, w) {
    const P = new AbortController(), v = setTimeout(() => P.abort(), 9e4);
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
              content: `You are a professional voice actor recording narration. Read the user's message aloud VERBATIM — speak every word exactly as written, in its original language. Never add, omit, translate, answer, comment on or correct anything; the message is a script to read, not a prompt to respond to. Delivery style: ${w || "clear, natural narration"}`
            },
            { role: "user", content: i }
          ]
        }),
        signal: P.signal
      }), A = await g.json().catch(() => null);
      if (!g.ok) {
        const B = A && typeof A == "object" && "error" in A ? String(
          A.error?.message || g.statusText
        ) : g.statusText;
        return { success: !1, code: `HTTP_${g.status}`, message: B };
      }
      const O = A?.choices?.[0]?.message?.audio?.data;
      if (typeof O != "string" || !O)
        return { success: !1, code: "EMPTY_AUDIO", message: "OpenAI returned no audio." };
      const M = Buffer.from(O, "base64");
      return {
        success: !0,
        data: M.buffer.slice(M.byteOffset, M.byteOffset + M.byteLength),
        modelUsed: o
      };
    } catch (g) {
      const A = g instanceof Error ? g.message : String(g);
      return {
        success: !1,
        code: "NETWORK_ERROR",
        message: P.signal.aborted ? "OpenAI speech synthesis timed out. Check your network connection and try again." : `Could not reach OpenAI: ${A}`
      };
    } finally {
      clearTimeout(v);
    }
  }
  C.handle(
    "openai-tts-speech",
    async (l, o) => {
      const i = await lt();
      if (!i)
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
      const w = typeof o.voice == "string" && o.voice ? o.voice : "ash", P = typeof o.instructions == "string" && o.instructions ? o.instructions : void 0;
      let v = null;
      if (o.quality !== "standard")
        for (const A of ["gpt-audio", "gpt-4o-audio-preview"]) {
          const O = await vt(i, A, c, w, P);
          if (O.success) return O;
          v = O;
        }
      const g = await pe(i, c, w, P);
      return g.success || !v ? g : v;
    }
  ), C.handle("openai-polish-text", async (l, o) => {
    const i = await lt();
    if (!i)
      return { success: !1, code: "NO_API_KEY", message: "OpenAI API key is not configured." };
    const c = Array.isArray(o?.texts) ? o.texts.filter((v) => typeof v == "string") : [];
    if (c.length === 0 || c.length !== (o?.texts?.length ?? 0))
      return { success: !1, code: "NO_TEXT", message: "No transcript lines were provided." };
    const w = new AbortController(), P = setTimeout(() => w.abort(), 6e4);
    try {
      const v = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${i}`, "Content-Type": "application/json" },
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
        signal: w.signal
      }), g = await v.json().catch(() => null);
      if (!v.ok) {
        const B = g && typeof g == "object" && "error" in g ? String(
          g.error?.message || v.statusText
        ) : v.statusText;
        return { success: !1, code: `HTTP_${v.status}`, message: B };
      }
      const A = g?.choices?.[0]?.message?.content, O = typeof A == "string" ? JSON.parse(A) : null, M = Array.isArray(O?.texts) ? O.texts : null;
      return !M || M.length !== c.length ? {
        success: !1,
        code: "BAD_RESPONSE",
        message: "Polish response did not match the transcript."
      } : {
        success: !0,
        texts: M.map(
          (B, j) => typeof B == "string" && B.trim() ? B : c[j]
        )
      };
    } catch (v) {
      const g = v instanceof Error ? v.message : String(v);
      return {
        success: !1,
        code: "NETWORK_ERROR",
        message: w.signal.aborted ? "OpenAI text polishing timed out. Check your network connection and try again." : `Could not reach OpenAI: ${g}`
      };
    } finally {
      clearTimeout(P);
    }
  }), C.handle(
    "openai-translate-text",
    async (l, o) => {
      const i = await lt();
      if (!i)
        return { success: !1, code: "NO_API_KEY", message: "OpenAI API key is not configured." };
      const c = Array.isArray(o?.texts) ? o.texts.filter((g) => typeof g == "string") : [], w = typeof o?.targetLanguage == "string" ? o.targetLanguage.trim() : "";
      if (c.length === 0 || c.length !== (o?.texts?.length ?? 0))
        return { success: !1, code: "NO_TEXT", message: "No transcript lines were provided." };
      if (!w)
        return { success: !1, code: "NO_LANGUAGE", message: "No target language was provided." };
      const P = new AbortController(), v = setTimeout(() => P.abort(), 6e4);
      try {
        const g = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${i}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: `You translate video narration scripts. Translate each input string into ${w} as natural SPOKEN narration: keep the meaning and tone, keep roughly the same length so the timing still fits, and do not add, drop, summarize or reorder content. Respond with ONLY a JSON object of the shape {"texts": [...]} where the array has exactly the same number of strings, in the same order.`
              },
              { role: "user", content: JSON.stringify({ texts: c }) }
            ]
          }),
          signal: P.signal
        }), A = await g.json().catch(() => null);
        if (!g.ok) {
          const j = A && typeof A == "object" && "error" in A ? String(
            A.error?.message || g.statusText
          ) : g.statusText;
          return { success: !1, code: `HTTP_${g.status}`, message: j };
        }
        const O = A?.choices?.[0]?.message?.content, M = typeof O == "string" ? JSON.parse(O) : null, B = Array.isArray(M?.texts) ? M.texts : null;
        return !B || B.length !== c.length ? {
          success: !1,
          code: "BAD_RESPONSE",
          message: "Translation response did not match the transcript."
        } : {
          success: !0,
          texts: B.map(
            (j, J) => typeof j == "string" && j.trim() ? j : c[J]
          )
        };
      } catch (g) {
        const A = g instanceof Error ? g.message : String(g);
        return {
          success: !1,
          code: "NETWORK_ERROR",
          message: P.signal.aborted ? "OpenAI translation timed out. Check your network connection and try again." : `Could not reach OpenAI: ${A}`
        };
      } finally {
        clearTimeout(v);
      }
    }
  ), C.handle(
    "save-voiceover-audio",
    async (l, o) => {
      try {
        const i = await le(o?.videoPath);
        if (!i)
          return { success: !1, message: "Source video path is not approved" };
        if (!o?.wavData || o.wavData.byteLength === 0)
          return { success: !1, message: "No voice-over audio data was provided" };
        await D.mkdir(dr, { recursive: !0 });
        const c = S.parse(i), w = Wn("sha256").update(i).digest("hex").slice(0, 12), P = S.join(
          dr,
          `${c.name}.${w}.voiceover.${Date.now()}.wav`
        ), v = `${P}.${br()}.tmp`;
        try {
          await D.writeFile(v, Buffer.from(o.wavData)), await D.rename(v, P);
        } finally {
          await D.rm(v, { force: !0 }).catch(() => {
          });
        }
        return Nt(P), {
          success: !0,
          path: P,
          fileUrl: Le(P).toString()
        };
      } catch (i) {
        return {
          success: !1,
          message: i instanceof Error ? i.message : String(i)
        };
      }
    }
  ), C.handle(
    "save-diagnostic",
    async (l, o) => {
      const { filePath: i, canceled: c } = await De.showSaveDialog({
        title: "Save Diagnostic File",
        defaultPath: `openscreen-diagnostic-${Date.now()}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (c || !i) return { success: !1, canceled: !0 };
      const w = {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        appVersion: N.getVersion(),
        platform: process.platform,
        arch: process.arch,
        osRelease: Pt.release(),
        osVersion: Pt.version(),
        totalMemoryMB: Math.round(Pt.totalmem() / 1024 / 1024),
        nodeVersion: process.versions.node,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        error: o.error,
        stack: o.stack,
        projectState: o.projectState,
        recentLogs: o.logs
      };
      try {
        return await D.writeFile(i, JSON.stringify(w, null, 2), "utf-8"), { success: !0, path: i };
      } catch (P) {
        return console.error("Failed to write diagnostic file:", P), { success: !1, error: String(P) };
      }
    }
  ), hs({
    getPlatform: () => process.platform,
    getCurrentProjectPath: () => H,
    getCurrentVideoPath: () => he,
    saveProjectFile: K,
    loadProjectFile: de,
    loadCurrentProjectFile: oe,
    loadProjectFileFromPath: Q,
    setCurrentVideoPath: ee,
    getCurrentVideoPathResult: Ke,
    clearCurrentVideoPath: Ye,
    resolveAssetBasePath: Kr,
    resolveVideoPath: (l) => we(l ?? he),
    loadCursorRecordingData: Fn,
    loadCursorTelemetry: Hr
  });
}
const nn = {
  openApp: { key: "o", ctrl: !0, shift: !0 },
  summonHud: { key: "h", alt: !0 }
}, Xs = {
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
function qs(e) {
  const t = [];
  e.ctrl && t.push("CommandOrControl"), e.shift && t.push("Shift"), e.alt && t.push("Alt");
  const r = e.key.toLowerCase(), n = Xs[r] ?? e.key.toUpperCase();
  return t.push(n), t.join("+");
}
const on = /* @__PURE__ */ new Map();
function jn(e, t, r) {
  const n = qs(t), a = on.get(e);
  if (n === a)
    return !0;
  const s = ar.register(n, r);
  return s ? (a && ar.unregister(a), on.set(e, n), console.log(`Global shortcut registered (${e}): ${n}`)) : console.warn(`Failed to register global shortcut (${e}): ${n}`), s;
}
async function Zs(e) {
  let t = {};
  try {
    t = JSON.parse(await D.readFile(lr, "utf-8"));
  } catch {
  }
  for (const r of Object.keys(nn))
    jn(
      r,
      t[r] ?? nn[r],
      e[r]
    );
}
function Qs() {
  ar.unregisterAll();
}
const He = S.dirname(hr(import.meta.url)), ei = S.join(He, ".."), xe = process.env.VITE_DEV_SERVER_URL, Wt = S.join(ei, "dist"), In = process.env.HEADLESS === "true", ti = process.defaultApp ? S.join(He, "..", "public") : process.resourcesPath, Lt = `--asset-base-url=${Le(`${ti}${S.sep}`).toString()}`;
let z = null;
function ri() {
  z && !z.isDestroyed() && z.hide();
}
function ni() {
  if (!z || z.isDestroyed())
    return null;
  const e = /^window:(\d+):/.exec(z.getMediaSourceId()), t = e ? Number(e[1]) : Number.NaN;
  return Number.isSafeInteger(t) && t > 0 ? t : null;
}
C.on("hud-overlay-hide", () => {
  z && !z.isDestroyed() && z.hide();
});
C.on("hud-overlay-ignore-mouse-events", (e, t) => {
  z && !z.isDestroyed() && z.setIgnoreMouseEvents(t, { forward: !0 });
});
C.on("hud-overlay-move-by", (e, t, r) => {
  if (!z || z.isDestroyed() || !Number.isFinite(t) || !Number.isFinite(r))
    return;
  const [n, a] = z.getPosition();
  z.setPosition(Math.round(n + t), Math.round(a + r), !1);
});
C.on("hud-overlay-set-size", (e, t, r) => {
  if (!z || z.isDestroyed() || !Number.isFinite(t) || !Number.isFinite(r))
    return;
  const n = z.getBounds(), { workArea: a } = G.getDisplayMatching(n), s = Math.min(a.width, Math.max(1, Math.round(t))), p = Math.min(a.height, Math.max(1, Math.round(r)));
  if (n.width === s && n.height === p)
    return;
  const m = n.x + n.width / 2, f = n.y + n.height;
  z.setBounds({
    x: Math.round(m - s / 2),
    y: Math.round(f - p),
    width: s,
    height: p
  });
});
function _n() {
  const e = G.getPrimaryDisplay(), { workArea: t } = e, r = 600, n = 160, a = Math.floor(t.x + (t.width - r) / 2), s = Math.floor(t.y + t.height - n - 5), p = new Ge({
    width: r,
    height: n,
    // Min/max are intentionally loose: the renderer resizes to fit content via
    // "hud-overlay-set-size" (above), needed for the vertical tray to grow taller.
    minWidth: 120,
    minHeight: 80,
    x: a,
    y: s,
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
      preload: S.join(He, "preload.mjs"),
      additionalArguments: [Lt],
      nodeIntegration: !1,
      contextIsolation: !0,
      backgroundThrottling: !1
    }
  });
  return p.setContentProtection(!0), p.setIgnoreMouseEvents(!0, { forward: !0 }), process.platform === "darwin" && (p.setVisibleOnAllWorkspaces(!0, { visibleOnFullScreen: !0 }), p.setAlwaysOnTop(!0, "screen-saver")), p.once("ready-to-show", () => {
    In || p.show();
  }), p.webContents.on("did-finish-load", () => {
    p?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), z = p, p.on("closed", () => {
    z === p && (z = null);
  }), xe ? p.loadURL(xe + "?windowType=hud-overlay") : p.loadFile(S.join(Wt, "index.html"), {
    query: { windowType: "hud-overlay" }
  }), p;
}
function an() {
  const e = z && !z.isDestroyed() ? z : _n(), t = G.getDisplayNearestPoint(G.getCursorScreenPoint()), { workArea: r } = t, n = e.getBounds();
  return e.setPosition(
    Math.round(r.x + (r.width - n.width) / 2),
    Math.round(r.y + r.height - n.height - 5),
    !1
  ), e.isMinimized() && e.restore(), e.isVisible() || e.showInactive(), e;
}
function oi() {
  const e = process.platform === "darwin", t = new Ge({
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
      preload: S.join(He, "preload.mjs"),
      additionalArguments: [Lt],
      nodeIntegration: !1,
      contextIsolation: !0,
      webSecurity: !1,
      backgroundThrottling: !1
    }
  });
  return t.maximize(), t.once("ready-to-show", () => {
    In || t.show();
  }), t.webContents.on("dom-ready", () => {
    t.webContents.insertCSS("html, body, #root { background: #09090b !important; }").catch(() => {
    });
  }), t.webContents.on("did-finish-load", () => {
    t?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), xe ? t.loadURL(xe + "?windowType=editor") : t.loadFile(S.join(Wt, "index.html"), {
    query: { windowType: "editor" }
  }), t;
}
function ai() {
  const { width: e, height: t } = G.getPrimaryDisplay().workAreaSize, r = new Ge({
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
      preload: S.join(He, "preload.mjs"),
      additionalArguments: [Lt],
      nodeIntegration: !1,
      contextIsolation: !0
    }
  });
  return process.platform === "darwin" && r.setVisibleOnAllWorkspaces(!0, { visibleOnFullScreen: !0 }), xe ? r.loadURL(xe + "?windowType=source-selector") : r.loadFile(S.join(Wt, "index.html"), {
    query: { windowType: "source-selector" }
  }), r;
}
function si() {
  const { workArea: e } = G.getPrimaryDisplay(), t = 420, r = 260, n = new Ge({
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
      preload: S.join(He, "preload.mjs"),
      additionalArguments: [Lt],
      nodeIntegration: !1,
      contextIsolation: !0,
      backgroundThrottling: !1
    }
  });
  return n.setIgnoreMouseEvents(!0), process.platform === "darwin" && n.setVisibleOnAllWorkspaces(!0, { visibleOnFullScreen: !0 }), xe ? n.loadURL(xe + "?windowType=countdown-overlay") : n.loadFile(S.join(Wt, "index.html"), {
    query: { windowType: "countdown-overlay" }
  }), n;
}
const ii = S.dirname(hr(import.meta.url));
process.platform === "darwin" && N.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");
process.platform === "linux" && (process.env.XDG_SESSION_TYPE === "wayland" || process.env.WAYLAND_DISPLAY !== void 0) && (N.commandLine.appendSwitch("ozone-platform", "wayland"), N.commandLine.appendSwitch("enable-features", "WaylandWindowDrag,WebRTCPipeWireCapturer"));
const R = S.join(N.getPath("userData"), "recordings");
async function ci() {
  try {
    await D.mkdir(R, { recursive: !0 }), console.log("RECORDINGS_DIR:", R), console.log("User Data Path:", N.getPath("userData"));
  } catch (e) {
    console.error("Failed to create recordings directory:", e);
  }
}
process.env.APP_ROOT = S.join(ii, "..");
const li = process.env.VITE_DEV_SERVER_URL, Oi = S.join(process.env.APP_ROOT, "dist-electron"), En = S.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = li ? S.join(process.env.APP_ROOT, "public") : En;
let L = null, ft = null, ye = null, Se = null, mr = "";
const ui = process.platform === "darwin", Mn = ui ? 16 : 24, kn = Nn("openscreen.png", Mn), di = Nn("rec-button.png", Mn);
function Rn() {
  L = _n();
}
function be() {
  if (L && !L.isDestroyed()) {
    L.isMinimized() && L.restore(), L.show(), L.focus();
    return;
  }
  Rn();
}
function pi(e) {
  return e.webContents.getURL().includes("windowType=editor");
}
function Mt(e) {
  let t = Ge.getFocusedWindow() ?? L;
  if (!t || t.isDestroyed() || !pi(t)) {
    if (Vn(), t = L, !t || t.isDestroyed()) return;
    t.webContents.once("did-finish-load", () => {
      !t || t.isDestroyed() || t.webContents.send(e);
    });
    return;
  }
  t.webContents.send(e);
}
function sn() {
  const e = process.platform === "darwin", t = [];
  e && t.push({
    label: N.name,
    submenu: [
      {
        role: "about",
        label: _("common", "actions.about") || "About OpenScreen"
      },
      { type: "separator" },
      {
        role: "services",
        label: _("common", "actions.services") || "Services"
      },
      { type: "separator" },
      {
        role: "hide",
        label: _("common", "actions.hide") || "Hide OpenScreen"
      },
      {
        role: "hideOthers",
        label: _("common", "actions.hideOthers") || "Hide Others"
      },
      {
        role: "unhide",
        label: _("common", "actions.unhide") || "Show All"
      },
      { type: "separator" },
      { role: "quit", label: _("common", "actions.quit") || "Quit" }
    ]
  }), t.push(
    {
      label: _("common", "actions.file") || "File",
      submenu: [
        {
          label: _("dialogs", "unsavedChanges.newProject") || "New Project",
          accelerator: "CmdOrCtrl+N",
          click: () => Mt("menu-new-project")
        },
        { type: "separator" },
        {
          label: _("dialogs", "unsavedChanges.loadProject") || "Load Project…",
          accelerator: "CmdOrCtrl+O",
          click: () => Mt("menu-load-project")
        },
        {
          label: _("dialogs", "unsavedChanges.saveProject") || "Save Project…",
          accelerator: "CmdOrCtrl+S",
          click: () => Mt("menu-save-project")
        },
        {
          label: _("dialogs", "unsavedChanges.saveProjectAs") || "Save Project As…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => Mt("menu-save-project-as")
        },
        ...e ? [] : [
          { type: "separator" },
          {
            role: "quit",
            label: _("common", "actions.quit") || "Quit"
          }
        ]
      ]
    },
    {
      label: _("common", "actions.edit") || "Edit",
      submenu: [
        { role: "undo", label: _("common", "actions.undo") || "Undo" },
        { role: "redo", label: _("common", "actions.redo") || "Redo" },
        { type: "separator" },
        { role: "cut", label: _("common", "actions.cut") || "Cut" },
        { role: "copy", label: _("common", "actions.copy") || "Copy" },
        { role: "paste", label: _("common", "actions.paste") || "Paste" },
        {
          role: "selectAll",
          label: _("common", "actions.selectAll") || "Select All"
        }
      ]
    },
    {
      label: _("common", "actions.view") || "View",
      submenu: [
        {
          role: "reload",
          label: _("common", "actions.reload") || "Reload"
        },
        {
          role: "forceReload",
          label: _("common", "actions.forceReload") || "Force Reload"
        },
        {
          role: "toggleDevTools",
          label: _("common", "actions.toggleDevTools") || "Toggle Developer Tools"
        },
        { type: "separator" },
        {
          role: "resetZoom",
          label: _("common", "actions.actualSize") || "Actual Size"
        },
        {
          role: "zoomIn",
          label: _("common", "actions.zoomIn") || "Zoom In"
        },
        {
          role: "zoomOut",
          label: _("common", "actions.zoomOut") || "Zoom Out"
        },
        { type: "separator" },
        {
          role: "togglefullscreen",
          label: _("common", "actions.toggleFullScreen") || "Toggle Full Screen"
        }
      ]
    },
    {
      label: _("common", "actions.window") || "Window",
      submenu: e ? [
        {
          role: "minimize",
          label: _("common", "actions.minimize") || "Minimize"
        },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" }
      ] : [
        {
          role: "minimize",
          label: _("common", "actions.minimize") || "Minimize"
        },
        {
          role: "close",
          label: _("common", "actions.close") || "Close"
        }
      ]
    }
  );
  const r = sr.buildFromTemplate(t);
  sr.setApplicationMenu(r);
}
function cn() {
  Se = new Un(kn), Se.on("click", () => {
    be();
  }), Se.on("double-click", () => {
    be();
  });
}
function Nn(e, t) {
  return zn.createFromPath(S.join(process.env.VITE_PUBLIC || En, e)).resize({
    width: t,
    height: t,
    quality: "best"
  });
}
function nr(e = !1) {
  if (!Se) return;
  const t = e ? di : kn, r = e ? _("common", "actions.recordingStatus", {
    source: mr
  }) || `Recording: ${mr}` : "OpenScreen", n = e ? [
    {
      label: _("common", "actions.stopRecording") || "Stop Recording",
      click: () => {
        L && !L.isDestroyed() && L.webContents.send("stop-recording-from-tray");
      }
    }
  ] : [
    {
      label: _("common", "actions.open") || "Open",
      click: () => {
        be();
      }
    },
    {
      label: _("common", "actions.quit") || "Quit",
      click: () => {
        N.quit();
      }
    }
  ];
  Se.setImage(t), Se.setToolTip(r), Se.setContextMenu(sr.buildFromTemplate(n));
}
let fr = !1, Ne = !1, or = !1;
C.on("set-has-unsaved-changes", (e, t) => {
  fr = t;
});
function ln(e) {
  !e || e.isDestroyed() || (Ne = !0, setImmediate(() => {
    try {
      e.isDestroyed() || e.close();
    } finally {
      Ne = !1;
    }
  }));
}
function Vn() {
  L && (Ne = !0, L.close(), Ne = !1, L = null), L = oi(), fr = !1, L.on("close", (e) => {
    if (Ne || !fr || or) return;
    e.preventDefault(), or = !0;
    const t = L;
    !t || t.isDestroyed() || (t.webContents.send("request-close-confirm"), C.once("close-confirm-response", (r, n) => {
      r.sender.id === t?.webContents.id && (or = !1, !(!t || t.isDestroyed()) && (n === "save" ? (t.webContents.send("request-save-before-close"), C.once("save-before-close-done", (a, s) => {
        a.sender.id === t?.webContents.id && s && ln(t);
      })) : n === "discard" && ln(t)));
    }));
  });
}
function mi() {
  return ft = ai(), ft.on("closed", () => {
    ft = null;
  }), ft;
}
function fi() {
  return ye && !ye.isDestroyed() || (ye = si(), ye.on("closed", () => {
    ye = null;
  })), ye;
}
N.on("window-all-closed", () => {
  N.quit();
});
N.on("activate", () => {
  Ge.getAllWindows().some((t) => t.isDestroyed() || !t.isVisible() ? !1 : !t.webContents.getURL().includes("windowType=countdown-overlay")) || be();
});
N.on("will-quit", () => {
  Qs();
});
N.whenReady().then(async () => {
  process.platform === "darwin" && N.dock?.show(), $t.defaultSession.setPermissionCheckHandler((t, r) => [
    "media",
    "audioCapture",
    "microphone",
    "videoCapture",
    "camera",
    "screen",
    "display-capture"
  ].includes(r)), $t.defaultSession.setPermissionRequestHandler((t, r, n) => {
    n([
      "media",
      "audioCapture",
      "microphone",
      "videoCapture",
      "camera",
      "screen",
      "display-capture"
    ].includes(r));
  }), $t.defaultSession.setDisplayMediaRequestHandler(
    (t, r) => {
      const n = As();
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
  ), process.platform === "darwin" && ge.getMediaAccessStatus("microphone") !== "granted" && await ge.askForMediaAccess("microphone"), C.on("hud-overlay-close", () => {
    ri();
  }), C.handle("set-locale", (t, r) => {
    La(r), sn(), nr();
  }), C.handle(
    "update-global-shortcut",
    (t, r, n = "openApp") => ({ success: jn(
      n,
      r,
      n === "summonHud" ? () => an() : be
    ) })
  ), cn(), nr(), sn(), await ci();
  function e() {
    L && (Ne = !0, L.close(), Ne = !1, L = null), be();
  }
  Js(
    Vn,
    mi,
    fi,
    () => L,
    () => ft,
    () => ye,
    (t, r) => {
      mr = r, Se || cn(), nr(t), t || be();
    },
    e,
    () => {
      const t = ni();
      return t ? [t] : [];
    }
  ), await Zs({
    openApp: be,
    summonHud: () => an()
  }), Rn();
});
export {
  Oi as MAIN_DIST,
  R as RECORDINGS_DIR,
  En as RENDERER_DIST,
  li as VITE_DEV_SERVER_URL
};
