/*global chrome, tgs, gsUtils, gsStorage, gsChrome */
(function(global) {
  'use strict';

  var currentTabs = {};

  function generateTabInfo(info) {
    // console.log(info.tabId, info);
    var timerStr =
      info && info.timerUp && info && info.timerUp !== '-'
        ? new Date(info.timerUp).toLocaleString()
        : '-';
    var html = '',
      windowId = info && info.windowId ? info.windowId : '?',
      tabId = info && info.tabId ? info.tabId : '?',
      tabIndex = info && info.tab ? info.tab.index : '?',
      tabTitle = info && info.tab ? gsUtils.htmlEncode(info.tab.title) : '?',
      tabTimer = timerStr,
      tabStatus = info ? info.status : '?';

    html += '<tr>';
    html += '<td>' + windowId + '</td>';
    html += '<td>' + tabId + '</td>';
    html += '<td>' + tabIndex + '</td>';
    html += '<td>' + tabTitle + '</td>';
    html += '<td>' + tabTimer + '</td>';
    html += '<td>' + tabStatus + '</td>';
    html += '</tr>';

    return html;
  }

  async function fetchInfo() {
    const tabs = await gsChrome.tabsQuery();
    const debugInfoPromises = [];
    for (const [i, curTab] of tabs.entries()) {
      currentTabs[tabs[i].id] = tabs[i];
      debugInfoPromises.push(
        new Promise(r => {
          chrome.runtime.sendMessage({function: 'getDebugInfo', tabId: curTab.id}, function (notice) {
            if (chrome.runtime.lastError) {
              gsUtils.error("Error while trying to get debug info", curTab, chrome.runtime.lastError);
            }

            o.tab = curTab;
            r(o);
          });
        })
      );
    }
    const debugInfos = await Promise.all(debugInfoPromises);
    for (const debugInfo of debugInfos) {
      var html,
        tableEl = document.getElementById('gsProfilerBody');
      html = generateTabInfo(debugInfo);
      tableEl.innerHTML = tableEl.innerHTML + html;
    }
  }

  function addFlagHtml(elementId, getterFn, setterFn) {
    document.getElementById(elementId).innerHTML = getterFn();
    document.getElementById(elementId).onclick = function(e) {
      const newVal = !getterFn();
      setterFn(newVal);
      document.getElementById(elementId).innerHTML = newVal;
    };
  }

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(async function() {
    await fetchInfo();
    addFlagHtml(
      'toggleDebugInfo',
      () => gsUtils.isDebugInfo(),
      newVal => gsUtils.setDebugInfo(newVal)
    );
    addFlagHtml(
      'toggleDebugError',
      () => gsUtils.isDebugError(),
      newVal => gsUtils.setDebugError(newVal)
    );
    const discardInPlaceOfSuspend = await gsStorage.getOption(gsStorage.DISCARD_IN_PLACE_OF_SUSPEND);
    addFlagHtml(
      'toggleDiscardInPlaceOfSuspend',
      () => discardInPlaceOfSuspend,
      newVal => {
        await gsStorage.setOptionAndSync(
          gsStorage.DISCARD_IN_PLACE_OF_SUSPEND,
          newVal
        );
      }
    );
    const useAltScreenCaptureLib = await gsStorage.getOption(gsStorage.USE_ALT_SCREEN_CAPTURE_LIB);
    addFlagHtml(
      'toggleUseAlternateScreenCaptureLib',
      () => useAltScreenCaptureLib,
      newVal => {
        await gsStorage.setOptionAndSync(
          gsStorage.USE_ALT_SCREEN_CAPTURE_LIB,
          newVal
        );
      }
    );
    document.getElementById('claimSuspendedTabs').onclick = async function(e) {
      const tabs = await gsChrome.tabsQuery();
      for (const tab of tabs) {
        if (
          gsUtils.isSuspendedTab(tab, true) &&
          tab.url.indexOf(chrome.runtime.id) < 0
        ) {
          const newUrl = tab.url.replace(
            gsUtils.getRootUrl(tab.url),
            chrome.runtime.id
          );
          await gsChrome.tabsUpdate(tab.id, { url: newUrl });
        }
      }
    };

    var extensionsUrl = `chrome://extensions/?id=${chrome.runtime.id}`;
    document
      .getElementById('backgroundPage')
      .setAttribute('href', extensionsUrl);
    document.getElementById('backgroundPage').onclick = function() {
      chrome.tabs.create({ url: extensionsUrl });
    };

    /*
        chrome.processes.onUpdatedWithMemory.addListener(function (processes) {
            chrome.tabs.query({}, function (tabs) {
                var html = '';
                html += generateMemStats(processes);
                html += '<br />';
                html += generateTabStats(tabs);
                document.getElementById('gsProfiler').innerHTML = html;
            });
        });
        */
  });
})(this);
