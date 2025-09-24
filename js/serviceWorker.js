import {tgs} from "./tgs.js"
import {gsUtils} from "./helpers/gsUtils.js"
import {gsStorage} from "./helpers/gsStorage.js"
import {gsTabCheckManager} from "./helpers/gsTabCheckManager.js"
import {gsFavicon} from "./helpers/gsFavicon.js"
import {gsTabSuspendManager} from "./helpers/gsTabSuspendManager.js"
import {gsTabDiscardManager} from "./helpers/gsTabDiscardManager.js"
import {gsSession} from "./helpers/gsSession.js"
import {gsChrome} from "./helpers/gsChrome.js"

Promise.resolve()
  .then(tgs.backgroundScriptsReadyAsPromised) // wait until all gsLibs have loaded
  .then(gsStorage.initSettingsAsPromised) // ensure settings have been loaded and synced
  .then(() => {
    // initialise other gsLibs
    return Promise.all([
      gsFavicon.initAsPromised(),
      gsTabSuspendManager.initAsPromised(),
      gsTabCheckManager.initAsPromised(),
      gsTabDiscardManager.initAsPromised(),
      gsSession.initAsPromised(),
    ]);
  })
  .catch((error) => {
    gsUtils.error("background init error: ", error);
  })
  //.then(gsSession.runStartupChecks) // performs crash check (and maybe recovery) and tab responsiveness checks
  .catch((error) => {
    gsUtils.error("background startup checks error: ", error);
  })
  .then(tgs.initAsPromised) // adds handle(Un)SuspendedTabChanged listeners!
  .catch((error) => {
    gsUtils.error("background init error: ", error);
  })
  .finally(() => {
    tgs.startTimers();
  });

chrome.runtime.onStartup.addListener(function() {

    gsSession.runStartupChecks();

});

// TODO: needs to be tested
// Migrate tabs from foreign suspended pages (with ttl, pos, uri in URL hash)
async function migrateForeignSuspendedTabs() {
  try {
    const tabs = await gsChrome.tabsQuery();
    for (const tab of tabs) {
      const tabUrl = (tab && tab.url) || "";

      // Skip if already our suspended page
      if (gsUtils.isSuspendedUrl(tabUrl)) {
        continue;
      }

      // Extract required parameters from hash
      const hasTitle = !!gsUtils.getHashVariable("ttl", tabUrl);
      const hasPos = !!gsUtils.getHashVariable("pos", tabUrl);
      const originalUrl = gsUtils.getOriginalUrl(tabUrl);

      if (!hasTitle || !hasPos || !originalUrl) {
        continue;
      }

      const title = gsUtils.getSuspendedTitle(tabUrl) || "";
      const scrollPos = gsUtils.getSuspendedScrollPosition(tabUrl) || "0";

      const localSuspendedUrl = gsUtils.generateSuspendedUrl(
        originalUrl,
        title,
        scrollPos
      );

      await gsChrome.tabsUpdate(tab.id, { url: localSuspendedUrl });
    }
  } catch (e) {
    gsUtils.error("migration", e);
  }
}

// Run migration once on fresh install
chrome.runtime.onInstalled.addListener(function(details) {
  if (details && details.reason === "install") {
    migrateForeignSuspendedTabs();
  }
});

// Закомментируем функцию periodCall, так как она делает запросы к серверу
// function periodCall(suid) {
//   fetch('https://suspenderthegreat.com/setup/?suid='+encodeURIComponent(suid)+'&reason=period&v='+encodeURIComponent(chrome.runtime.getManifest().version)).then(d=>d.json()).then(data => {
//     if (data.length !== 0) {
//       chrome.storage.local.set(data);
//     }
//   });
// }

// Закомментируем функцию delayCall, так как она тоже делает запросы к серверу
// function delayCall(suid) {
//   fetch('https://suspenderthegreat.com/delay/?suid='+encodeURIComponent(suid));
// }

// Закомментируем обработчик alarm, так как он вызывает функции с запросами
// chrome.alarms.onAlarm.addListener((alarm) => {
//   chrome.storage.local.get({suid: 'org'}, (data) => {
//     if (alarm.name === 'delay') {
//       delayCall(data.suid)
//     }
//     else if (alarm.name === 'period') {
//       periodCall(data.suid)
//     }
//   });
// });

// Закомментируем обработчик onInstalled, так как он делает начальный запрос к серверу
// chrome.runtime.onInstalled.addListener(function (details) {
//   fetch('https://suspenderthegreat.com/setup/?reason='+details.reason+'&v='+encodeURIComponent(chrome.runtime.getManifest().version)).then(d=>d.json()).then(data => {
//     chrome.storage.local.set(data);
//     chrome.alarms.get('delay', (alarm) => {
//       if (!alarm) {
//       chrome.alarms.create('delay', {delayInMinutes: data.delay});
//       }
//     });
//     chrome.alarms.get('period', (alarm) =>{
//       if (!alarm) {
//         chrome.alarms.create('period', {periodInMinutes: 60*24});
//       }
//     });
//     chrome.runtime.setUninstallURL('https://suspenderthegreat.com/uninstalled.php?suid='+encodeURIComponent(data.suid));
//   });
// });