// Code.js
/**
 * Serve the main HTML application
 */
function doGet(e) {
  const currentUser = getAuthenticatedUser();
  // Forzar detección de permisos de Drive
  try { DriveApp.getStorageUsed(); } catch(e) {}
  
  const htmlOutput = HtmlService.createTemplateFromFile('index');
  // Pass configuration variables to the frontend if needed
  htmlOutput.appTitle = "Mercurio PMS";
  htmlOutput.forceLogin = !currentUser;
  htmlOutput.currentUserId = currentUser ? currentUser.USER_ID || '' : '';
  htmlOutput.currentUserRole = currentUser ? currentUser.ROLE || '' : '';
  htmlOutput.currentUserAssignedVessel = currentUser ? currentUser.ASSIGNED_VESSEL || '' : '';
  htmlOutput.currentUserAssignedVessels = currentUser ? currentUser.ASSIGNED_VESSELS || '' : '';
  
  return htmlOutput.evaluate()
    .setTitle('Mercurio PMS - Fleet Maintenance')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Include HTML files within the main index (for Styles and Script)
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Endpoint called by the Frontend to get the list of Modules
 */
function getModulesConfig() {
  _requireAuthenticatedUser_();
  return [
    { id: 'daily_reports', name: 'REPORTE DIARIO DE OPERACIONES', icon: 'history_edu', color: 'c-blue', badge: 'URGENTE', bClass: 'mod-b-red-solid', dot: '!', link: true },
    { id: 'assets', name: 'INVENTARIO SFI', icon: 'inventory_2', color: 'c-orange', badge: 'A&B M&J', bClass: 'mod-b-yellow', link: true },
    { id: 'work_orders', name: 'ÓRDENES DE TRABAJO', icon: 'event_note', color: 'c-white', link: true },
    { id: 'inspections_plan', name: 'PLAN DE INSPECCIONES PERIÓDICAS', icon: 'schedule', color: 'c-blue', badge: 'NEW', bClass: 'mod-b-cyan', dot: '9.4', link: true },
    { id: 'inspections_log', name: 'REGISTROS DE INSPECCIONES PERIÓDICAS', icon: 'history', color: 'c-cyan', badge: 'LOG', bClass: 'mod-b-cyan', link: true },
    { id: 'maintenance_plan', name: 'PLAN DE MANTENIMIENTO', icon: 'description', color: 'c-blue', link: true },
    { id: 'condition_monitoring', name: 'MONITOREO POR CONDICIÓN', icon: 'speed', color: 'c-green', badge: 'TENDENCIA', bClass: 'mod-b-green', dot: '6.1', link: false },
    { id: 'deferrals', name: 'DIFERIMIENTOS Y BACKLOG', icon: 'update', color: 'c-yellow', badge: 'PROC-03', bClass: 'mod-b-yellow', link: true },
    { id: 'spares', name: 'REPUESTOS CRÍTICOS', icon: 'settings_suggest', iconColor: 'c-orange', badge: 'STOCK', bClass: 'mod-b-red', dot: '!', link: true },
    { id: 'defects', name: 'REGISTRO DE FALLAS', icon: 'report', color: 'c-red', badge: 'PROC-15', bClass: 'mod-b-red-solid', link: true },
    { id: 'rca', name: 'RCA LOG', icon: 'search_insights', color: 'c-orange', badge: 'PROC-18', bClass: 'mod-b-orange', link: true },
    { id: 'capa', name: 'CAPA LOG', icon: 'security', color: 'c-cyan', badge: 'PROC-19', bClass: 'mod-b-cyan', link: true },

    { id: 'certificates', name: 'CERTIFICADOS', icon: 'verified', color: 'c-green', badge: 'SAFE', bClass: 'mod-b-green', link: true },
    { id: 'spare_orders', name: 'PEDIDOS DE REPUESTOS', icon: 'shopping_cart', color: 'c-orange', badge: 'TRACKING', bClass: 'mod-b-orange', link: true },
    { id: 'proveedores', name: 'PROVEEDORES', icon: 'store', color: 'c-blue', badge: 'PROC-13', bClass: 'mod-b-cyan', link: true },
    { id: 'eval_proveedores', name: 'EVAL_PROVEEDORES', icon: 'rate_review', color: 'c-cyan', link: true },
    { id: 'nc_proveedores', name: 'NC_PROVEEDORES', icon: 'warning', color: 'c-red', link: true }
  ];
}

/**
 * Returns the OAuth token for the Google Picker
 */
function getOAuthToken() {
  _requireAuthenticatedUser_();
  return ScriptApp.getOAuthToken();
}
