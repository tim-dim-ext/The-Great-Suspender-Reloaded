import "./helpers/db.js"
import "./helpers/gsTabQueue.js"

import {gsUtils} from "./helpers/gsUtils.js"
import {gsChrome} from "./helpers/gsChrome.js"
import {gsStorage} from "./helpers/gsStorage.js"
import {gsIndexedDb} from "./helpers/gsIndexedDb.js"
import {gsMessages} from "./helpers/gsMessages.js"
import {gsSession} from "./helpers/gsSession.js"
import {gsTabCheckManager} from "./helpers/gsTabCheckManager.js"
import {gsFavicon} from "./helpers/gsFavicon.js"
import {gsTabSuspendManager} from "./helpers/gsTabSuspendManager.js"
import {gsTabDiscardManager} from "./helpers/gsTabDiscardManager.js"
import {gsSuspendedTab} from "./helpers/gsSuspendedTab.js"

export var tgs = (function () {
  // eslint-disable-line no-unused-vars
  "use strict";

  const ICON_SUSPENSION_ACTIVE = {
    16: "../images/icon-16x16.png",
    32: "../images/icon-32x32.png",
  };
  const ICON_SUSPENSION_PAUSED = {
    16: "../images/icon-16x16_grey.png",
    32: "../images/icon-32x32_grey.png",
  };

  // Unsuspended tab props
  const STATE_TIMER_DETAILS = "timerDetails";

  // Suspended tab props
  const STATE_TEMP_WHITELIST_ON_RELOAD = "whitelistOnReload";
  const STATE_DISABLE_UNSUSPEND_ON_RELOAD = "disableUnsuspendOnReload";
  const STATE_UNLOADED_URL = "unloadedUrl";
  const STATE_SHOW_NAG = "showNag";
  const STATE_SUSPEND_REASON = "suspendReason"; // 1=auto-suspend, 2=manual-suspend, 3=discarded
  const STATE_SCROLL_POS = "scrollPos";

  const focusDelay = 500;
  const noticeCheckInterval = 1000 * 60 * 60 * 12; // every 12 hours
  const sessionMetricsCheckInterval = 15; // every 15 minutes
  const analyticsCheckInterval = 60 * 23.5; // every 23.5 hours

  const _tabStateByTabId = {};
  const _currentFocusedTabIdByWindowId = {};
  const _currentStationaryTabIdByWindowId = {};

  let _currentFocusedWindowId;
  let _currentStationaryWindowId;
  let _sessionSaveTimer;
  let _newTabFocusTimer;
  let _newWindowFocusTimer;
  let _noticeToDisplay;
  let _isOnline = navigator.onLine;
  let _triggerHotkeyUpdate = false;
  let _suspensionToggleHotkey;

  function getExtensionGlobals() {
    const globals = {
      tgs,
      gsUtils,
      gsChrome,
      gsStorage,
      gsIndexedDb,
      gsMessages,
      gsSession,
      gsFavicon,
      gsTabCheckManager,
      gsTabSuspendManager,
      gsTabDiscardManager,
      gsSuspendedTab,
    };
    for (const lib of Object.values(globals)) {
      if (!lib) {
        return null;
      }
    }
    return globals;
  }

  function backgroundScriptsReadyAsPromised(retries) {
    retries = retries || 0;
    if (retries > 300) {
      // allow 30 seconds :scream:
      chrome.tabs.create({ url: chrome.runtime.getURL("broken.html") });
      return Promise.reject("Failed to initialise background scripts");
    }
    return new Promise(function (resolve) {
      const isReady = getExtensionGlobals() !== null;
      resolve(isReady);
    }).then(function (isReady) {
      if (isReady) {
        return Promise.resolve();
      }
      return new Promise(function (resolve) {
        window.setTimeout(resolve, 100);
      }).then(function () {
        retries += 1;
        return backgroundScriptsReadyAsPromised(retries);
      });
    });
  }

  function initAsPromised() {
    return new Promise(async function (resolve) {
      gsUtils.log("background", "PERFORMING BACKGROUND INIT...");
      addCommandListeners();
      addMessageListeners();
      addChromeListeners();

      //initialise unsuspended tab props
      resetAutoSuspendTimerForAllTabs();

      //add context menu items
      //TODO: Report chrome bug where adding context menu in incognito removes it from main windows
      if (!chrome.extension.inIncognitoContext) {
        buildContextMenu(false);
        var contextMenus = await gsStorage.getOption(gsStorage.ADD_CONTEXT);
        buildContextMenu(contextMenus);
      }

      //initialise currentStationary and currentFocused vars
      const activeTabs = await gsChrome.tabsQuery({ active: true });
      const currentWindow = await gsChrome.windowsGetLastFocused();
      for (let activeTab of activeTabs) {

       await chrome.storage.local.get({
          _currentFocusedTabIdByWindowId: {},
          _currentStationaryTabIdByWindowId: {}
        }, (d) =>{
          d['_currentStationaryTabIdByWindowId'][activeTab.windowId] = activeTab.id;
          d['_currentFocusedTabIdByWindowId'][activeTab.windowId] = activeTab.id;
          chrome.storage.local.set(d);
        });

        if (currentWindow && currentWindow.id === activeTab.windowId) {
          await chrome.storage.local.get({
            _currentStationaryWindowId: {},
            _currentStationaryTabIdByWindowId: {}
          }, (d) =>{
            d['_currentStationaryWindowId']= activeTab.windowId;
            d['_currentFocusedWindowId'] = activeTab.windowId;
            chrome.storage.local.set(d);
          });
        }
      }
      gsUtils.log("background", "init successful");
      resolve();
    });
  }

  function startTimers() {
    startSessionMetricsJob();
    startAnalyticsUpdateJob();
  }

  function getCurrentlyActiveTab(callback) {
    // wrap this in an anonymous async function so we can use await
    (async function () {
      const currentWindowActiveTabs = await gsChrome.tabsQuery({
        active: true,
        currentWindow: true,
      });
      if (currentWindowActiveTabs.length > 0) {
        callback(currentWindowActiveTabs[0]);
        return;
      }

      // Fallback on chrome.windows.getLastFocused
      const lastFocusedWindow = await gsChrome.windowsGetLastFocused();
      if (lastFocusedWindow) {
        const lastFocusedWindowActiveTabs = await gsChrome.tabsQuery({
          active: true,
          windowId: lastFocusedWindow.id,
        });
        if (lastFocusedWindowActiveTabs.length > 0) {
          callback(lastFocusedWindowActiveTabs[0]);
          return;
        }
      }

      // Fallback on _currentStationaryWindowId
      if (_currentStationaryWindowId) {
        const currentStationaryWindowActiveTabs = await gsChrome.tabsQuery({
          active: true,
          windowId: _currentStationaryWindowId,
        });
        if (currentStationaryWindowActiveTabs.length > 0) {
          callback(currentStationaryWindowActiveTabs[0]);
          return;
        }

        // Fallback on currentStationaryTabId
        const currentStationaryTabId =
          _currentStationaryTabIdByWindowId[_currentStationaryWindowId];
        if (currentStationaryTabId) {
          const currentStationaryTab = await gsChrome.tabsGet(
            currentStationaryTabId
          );
          if (currentStationaryTab !== null) {
            callback(currentStationaryTab);
            return;
          }
        }
      }
      callback(null);
    })();
  }

  // NOTE: Stationary here means has had focus for more than focusDelay ms
  // So it may not necessarily have the tab.active flag set to true
  function isCurrentStationaryTab(tab) {
    if (tab.windowId !== _currentStationaryWindowId) {
      return false;
    }
    var lastStationaryTabIdForWindow =
      _currentStationaryTabIdByWindowId[tab.windowId];
    if (lastStationaryTabIdForWindow) {
      return tab.id === lastStationaryTabIdForWindow;
    } else {
      // fallback on active flag
      return tab.active;
    }
  }

  function isCurrentFocusedTab(tab) {
    if (tab.windowId !== _currentFocusedWindowId) {
      return false;
    }
    var currentFocusedTabIdForWindow =
      _currentFocusedTabIdByWindowId[tab.windowId];
    if (currentFocusedTabIdForWindow) {
      return tab.id === currentFocusedTabIdForWindow;
    } else {
      // fallback on active flag
      return tab.active;
    }
  }

  function isCurrentActiveTab(tab) {
    const activeTabIdForWindow = _currentFocusedTabIdByWindowId[tab.windowId];
    if (activeTabIdForWindow) {
      return tab.id === activeTabIdForWindow;
    } else {
      // fallback on active flag
      return tab.active;
    }
  }

  function whitelistHighlightedTab(includePath) {
    includePath = includePath || false;
    getCurrentlyActiveTab(function (activeTab) {
      if (activeTab) {
        if (gsUtils.isSuspendedTab(activeTab)) {
          let url = gsUtils.getRootUrl(
            gsUtils.getOriginalUrl(activeTab.url),
            includePath,
            false
          );
          gsUtils.saveToWhitelist(url);
          unsuspendTab(activeTab);
        } else if (gsUtils.isNormalTab(activeTab)) {
          let url = gsUtils.getRootUrl(activeTab.url, includePath, false);
          gsUtils.saveToWhitelist(url);
          calculateTabStatus(activeTab, null, function (status) {
            setIconStatus(status, activeTab.id);
          });
        }
      }
    });
  }

  function unwhitelistHighlightedTab(callback) {
    getCurrentlyActiveTab(async function (activeTab) {
      if (activeTab) {
        await gsUtils.removeFromWhitelist(activeTab.url);
        calculateTabStatus(activeTab, null, function (status) {
          setIconStatus(status, activeTab.id);
          if (callback) callback(status);
        });
      } else {
        if (callback) callback(gsUtils.STATUS_UNKNOWN);
      }
    });
  }

  function requestToggleTempWhitelistStateOfHighlightedTab(callback) {
    getCurrentlyActiveTab(function (activeTab) {
      if (!activeTab) {
        if (callback) callback(status);
        return;
      }
      if (gsUtils.isSuspendedTab(activeTab)) {
        setTabStatePropForTabId(
          activeTab.id,
          STATE_TEMP_WHITELIST_ON_RELOAD,
          true
        );
        gsSuspendedTab.requestUnsuspendTab(activeTab);
    
        if (callback) callback(gsUtils.STATUS_UNKNOWN);
        
        return;
      }
      if (!gsUtils.isNormalTab(activeTab, true)) {
        if (callback) callback(gsUtils.STATUS_UNKNOWN);
        return;
      }

      calculateTabStatus(activeTab, null, function (status) {
        if (
          status === gsUtils.STATUS_ACTIVE ||
          status === gsUtils.STATUS_NORMAL
        ) {
          setTempWhitelistStateForTab(activeTab, callback);
        } else if (
          status === gsUtils.STATUS_TEMPWHITELIST ||
          status === gsUtils.STATUS_FORMINPUT
        ) {
          unsetTempWhitelistStateForTab(activeTab, callback);
        } else {
          if (callback) callback(status);
        }
      });
    });
  }

  function setTempWhitelistStateForTab(tab, callback) {
    gsMessages.sendTemporaryWhitelistToContentScript(
      tab.id,
      function (error, response) {
        if (error) {
          gsUtils.warning(
            tab.id,
            "Failed to sendTemporaryWhitelistToContentScript",
            error
          );
        }
        var contentScriptStatus =
          response && response.status ? response.status : null;
        calculateTabStatus(tab, contentScriptStatus, function (newStatus) {
          setIconStatus(newStatus, tab.id);
          //This is a hotfix for issue #723
          if (newStatus === "tempWhitelist" && tab.autoDiscardable) {
            chrome.tabs.update(tab.id, {
              autoDiscardable: false,
            });
          }
          if (callback) callback(newStatus);
        });
      }
    );
  }

  function unsetTempWhitelistStateForTab(tab, callback) {
    gsMessages.sendUndoTemporaryWhitelistToContentScript(
      tab.id,
      function (error, response) {
        if (error) {
          gsUtils.warning(
            tab.id,
            "Failed to sendUndoTemporaryWhitelistToContentScript",
            error
          );
        }
        var contentScriptStatus =
          response && response.status ? response.status : null;
        calculateTabStatus(tab, contentScriptStatus, function (newStatus) {
          setIconStatus(newStatus, tab.id);
          //This is a hotfix for issue #723
          if (newStatus !== "tempWhitelist" && !tab.autoDiscardable) {
            chrome.tabs.update(tab.id, {
              //async
              autoDiscardable: true,
            });
          }
          if (callback) callback(newStatus);
        });
      }
    );
  }

  function openLinkInSuspendedTab(parentTab, linkedUrl) {
    //imitate chromes 'open link in new tab' behaviour in how it selects the correct index
    chrome.tabs.query(
      { windowId: chrome.windows.WINDOW_ID_CURRENT },
      (tabs) => {
        var newTabIndex = parentTab.index + 1;
        var nextTab = tabs[newTabIndex];
        while (nextTab && nextTab.openerTabId === parentTab.id) {
          newTabIndex++;
          nextTab = tabs[newTabIndex];
        }
        var newTabProperties = {
          url: linkedUrl,
          index: newTabIndex,
          openerTabId: parentTab.id,
          active: false,
        };
        chrome.tabs.create(newTabProperties, (tab) => {
          gsTabSuspendManager.queueTabForSuspension(tab, 1);
        });
      }
    );
  }

  function toggleSuspendedStateOfHighlightedTab() {
    getCurrentlyActiveTab((activeTab) => {
      if (activeTab) {
        if (gsUtils.isSuspendedTab(activeTab)) {
          unsuspendTab(activeTab);
        } else {
          gsTabSuspendManager.queueTabForSuspension(activeTab, 1);
        }
      }
    });
  }

  function suspendHighlightedTab() {
    getCurrentlyActiveTab((activeTab) => {
      if (activeTab) {
        gsTabSuspendManager.queueTabForSuspension(activeTab, 1);
      }
    });
  }

  function unsuspendHighlightedTab() {
    getCurrentlyActiveTab((activeTab) => {
      if (activeTab && gsUtils.isSuspendedTab(activeTab)) {
        unsuspendTab(activeTab);
      }
    });
  }

  function suspendAllTabs(force) {
    const forceLevel = force ? 1 : 2;
    getCurrentlyActiveTab((activeTab) => {
      if (!activeTab) {
        gsUtils.warning(
          "background",
          "Could not determine currently active window."
        );
        return;
      }
      chrome.windows.get(
        activeTab.windowId,
        { populate: true },
        (curWindow) => {
          for (const tab of curWindow.tabs) {
            if (!tab.active) {
              gsTabSuspendManager.queueTabForSuspension(tab, forceLevel);
            }
          }
        }
      );
    });
  }

  function suspendAllTabsInAllWindows(force) {
    const forceLevel = force ? 1 : 2;
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        gsTabSuspendManager.queueTabForSuspension(tab, forceLevel);
      }
    });
  }

  function unsuspendAllTabs() {
    getCurrentlyActiveTab(function (activeTab) {
      if (!activeTab) {
        gsUtils.warning(
          "background",
          "Could not determine currently active window."
        );
        return;
      }
      chrome.windows.get(
        activeTab.windowId,
        { populate: true },
        (curWindow) => {
          for (const tab of curWindow.tabs) {
            gsTabSuspendManager.unqueueTabForSuspension(tab);
            if (gsUtils.isSuspendedTab(tab)) {
              unsuspendTab(tab);
            } else if (gsUtils.isNormalTab(tab) && !tab.active) {
              resetAutoSuspendTimerForTab(tab);
            }
          }
        }
      );
    });
  }

  function unsuspendAllTabsInAllWindows() {
    chrome.windows.getLastFocused({}, (currentWindow) => {
      chrome.tabs.query({}, (tabs) => {
        // Because of the way that unsuspending steals window focus, we defer the suspending of tabs in the
        // current window until last
        var deferredTabs = [];
        for (const tab of tabs) {
          gsTabSuspendManager.unqueueTabForSuspension(tab);
          if (gsUtils.isSuspendedTab(tab)) {
            if (tab.windowId === currentWindow.id) {
              deferredTabs.push(tab);
            } else {
              unsuspendTab(tab);
            }
          } else if (gsUtils.isNormalTab(tab)) {
            resetAutoSuspendTimerForTab(tab);
          }
        }
        for (const tab of deferredTabs) {
          unsuspendTab(tab);
        }
      });
    });
  }

  function suspendSelectedTabs() {
    chrome.tabs.query(
      { highlighted: true, lastFocusedWindow: true },
      (selectedTabs) => {
        for (const tab of selectedTabs) {
          gsTabSuspendManager.queueTabForSuspension(tab, 1);
        }
      }
    );
  }

  function unsuspendSelectedTabs() {
    chrome.tabs.query(
      { highlighted: true, lastFocusedWindow: true },
      (selectedTabs) => {
        for (const tab of selectedTabs) {
          gsTabSuspendManager.unqueueTabForSuspension(tab);
          if (gsUtils.isSuspendedTab(tab)) {
            unsuspendTab(tab);
          }
        }
      }
    );
  }

  function queueSessionTimer() {
    clearTimeout(_sessionSaveTimer);
    _sessionSaveTimer = setTimeout(function () {
      gsUtils.log("background", "updating current session");
      gsSession.updateCurrentSession(); //async
    }, 1000);
  }

  async function resetAutoSuspendTimerForTab(tab) {
    clearAutoSuspendTimerForTabId(tab.id);

    let timeToSuspend = await gsStorage.getOption(gsStorage.SUSPEND_TIME);
    // Older extension version had possibility of setting this to 20 seconds but minimum Chrome alarms delay is 1 minute
    if (timeToSuspend == 0.33) {
      timeToSuspend = 1;
    }
    const isProtectedActiveTab = await gsUtils.isProtectedActiveTab(tab);
    if (
      isProtectedActiveTab ||
      isNaN(timeToSuspend) ||
      timeToSuspend <= 0
    ) {
      return;
    }

    const timerDetails = {};
    timerDetails.tabId = tab.id;
    timerDetails.suspendDateTime = new Date(
      new Date().getTime() + timeToSuspend
    );

    chrome.alarms.create('autoSuspend' + tab.id, {delayInMinutes: Number(timeToSuspend)});

    gsUtils.log(
      tab.id,
      "Adding tab timer for: " + timerDetails.suspendDateTime
    );

    setTabStatePropForTabId(tab.id, STATE_TIMER_DETAILS, timerDetails);
  }

  function resetAutoSuspendTimerForAllTabs() {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (gsUtils.isNormalTab(tab)) {
          resetAutoSuspendTimerForTab(tab);
        }
      }
    });
  }

  function clearAutoSuspendTimerForTabId(tabId) {
    const timerDetails = getTabStatePropForTabId(tabId, STATE_TIMER_DETAILS);
    if (!timerDetails) {
      return;
    }
    gsUtils.log(tabId, "Removing tab timer.");
    chrome.alarms.clear('autoSuspend' + tabId);
    setTabStatePropForTabId(tabId, STATE_TIMER_DETAILS, null);
  }

  function getTabStatePropForTabId(tabId, prop) {
    return _tabStateByTabId[tabId] ? _tabStateByTabId[tabId][prop] : undefined;
  }
  function setTabStatePropForTabId(tabId, prop, value) {
    // gsUtils.log(tabId, `Setting tab state prop: ${prop}:`, value);
    const tabState = _tabStateByTabId[tabId] || {};
    tabState[prop] = value;
    _tabStateByTabId[tabId] = tabState;
  }
  function clearTabStateForTabId(tabId) {
    gsUtils.log(tabId, "Clearing tab state props:", _tabStateByTabId[tabId]);
    clearAutoSuspendTimerForTabId(tabId);
    delete _tabStateByTabId[tabId];
  }

  async function unsuspendTab(tab) {
    if (!gsUtils.isSuspendedTab(tab)) return;

    const scrollPosition = gsUtils.getSuspendedScrollPosition(tab.url);
    tgs.setTabStatePropForTabId(tab.id, tgs.STATE_SCROLL_POS, scrollPosition);

    // If the suspended tab is discarded then reload the suspended tab and flag
    // if for unsuspend on reload.
    // This will happen if the 'discard suspended tabs' option is turned on and the tab
    // is being unsuspended remotely.
    if (gsUtils.isDiscardedTab(tab)) {
      gsUtils.log(tab.id, "Unsuspending discarded tab via reload");
      setTabStatePropForTabId(tab.id, STATE_UNLOADED_URL, tab.url);
      gsChrome.tabsReload(tab.id); //async. unhandled promise
      return;
    }

    let _tab = await gsChrome.tabsGet(tab.id);
    if (_tab) {
      gsUtils.log(tab.id, "Requesting unsuspend via gsSuspendedTab");
      gsSuspendedTab.requestUnsuspendTab(tab);
      return;
    }
    else {
      gsUtils.log(tab.id, "tab does not exist in unsuspendTab", tab);
    }

    // Reloading directly causes a history item for the suspended tab to be made in the tab history.
    let url = gsUtils.getOriginalUrl(tab.url);
    if (url) {
      gsUtils.log(tab.id, "Unsuspending tab via chrome.tabs.update");
      chrome.tabs.update(tab.id, { url: url });
      return;
    }

    gsUtils.log(tab.id, "Failed to execute unsuspend tab.");
  }

  function buildSuspensionToggleHotkey() {
    return new Promise((resolve) => {
      let printableHotkey = "";
      chrome.commands.getAll((commands) => {
        const toggleCommand = commands.find((o) => o.name === "1-suspend-tab");
        if (toggleCommand && toggleCommand.shortcut !== "") {
          printableHotkey = gsUtils.formatHotkeyString(toggleCommand.shortcut);
          resolve(printableHotkey);
        } else {
          resolve(null);
        }
      });
    });
  }

  function checkForTriggerUrls(tab, url) {
    // test for special case of a successful donation
    if (url.indexOf("greatsuspender.github.io/thanks.html") > 0) {
      gsStorage.setOptionAndSync(gsStorage.NO_NAG, true);
      chrome.tabs.update(tab.id, {
        url: chrome.runtime.getURL("html/thanks.html"),
      });

      // test for a save of keyboard shortcuts (chrome://extensions/shortcuts)
    } else if (url === "chrome://extensions/shortcuts") {
      _triggerHotkeyUpdate = true;
    }
  }

  async function handleUnsuspendedTabStateChanged(tab, changeInfo) {
    if (
      !changeInfo.hasOwnProperty("status") &&
      !changeInfo.hasOwnProperty("audible") &&
      !changeInfo.hasOwnProperty("pinned") &&
      !changeInfo.hasOwnProperty("discarded")
    ) {
      return;
    }
    gsUtils.log(
      tab.id,
      "unsuspended tab state changed. changeInfo: ",
      changeInfo
    );

    // Ensure we clear the STATE_UNLOADED_URL flag during load in case the
    // tab is suspended again before loading can finish (in which case on
    // suspended tab complete, the tab will reload again)
    if (
      changeInfo.hasOwnProperty("status") &&
      changeInfo.status === "loading"
    ) {
      setTabStatePropForTabId(tab.id, STATE_UNLOADED_URL, null);
    }

    // Check if tab has just been discarded
    if (changeInfo.hasOwnProperty("discarded") && changeInfo.discarded) {
      const existingSuspendReason = getTabStatePropForTabId(
        tab.id,
        STATE_SUSPEND_REASON
      );
      if (existingSuspendReason && existingSuspendReason === 3) {
        // For some reason the discarded changeInfo gets called twice (chrome bug?)
        // As a workaround we use the suspend reason to determine if we've already
        // handled this discard
        //TODO: Report chrome bug
        return;
      }
      gsUtils.log(
        tab.id,
        "Unsuspended tab has been discarded. Url: " + tab.url
      );
      gsTabDiscardManager.handleDiscardedUnsuspendedTab(tab); //async. unhandled promise.

      // When a tab is discarded the tab id changes. We need up-to-date UNSUSPENDED
      // tabIds in the current session otherwise crash recovery will not work
      queueSessionTimer();
      return;
    }

    // Check if tab is queued for suspension
    const queuedTabDetails = gsTabSuspendManager.getQueuedTabDetails(tab);
    if (queuedTabDetails) {
      // Requeue tab to wake it from possible sleep
      delete queuedTabDetails.executionProps.refetchTab;
      gsTabSuspendManager.queueTabForSuspension(
        tab,
        queuedTabDetails.executionProps.forceLevel
      );
      return;
    }

    let hasTabStatusChanged = false;

    // Check for change in tabs audible status
    if (changeInfo.hasOwnProperty("audible")) {
      //reset tab timer if tab has just finished playing audio
      if (!changeInfo.audible && await gsStorage.getOption(gsStorage.IGNORE_AUDIO)) {
        resetAutoSuspendTimerForTab(tab);
      }
      hasTabStatusChanged = true;
    }
    if (changeInfo.hasOwnProperty("pinned")) {
      //reset tab timer if tab has become unpinned
      if (!changeInfo.pinned && await gsStorage.getOption(gsStorage.IGNORE_PINNED)) {
        resetAutoSuspendTimerForTab(tab);
      }
      hasTabStatusChanged = true;
    }

    if (changeInfo.hasOwnProperty("status")) {
      if (changeInfo.status === "complete") {
        const tempWhitelistOnReload = getTabStatePropForTabId(
          tab.id,
          STATE_TEMP_WHITELIST_ON_RELOAD
        );
        const scrollPos =
          getTabStatePropForTabId(tab.id, STATE_SCROLL_POS) || null;
        clearTabStateForTabId(tab.id);

        //init loaded tab
        resetAutoSuspendTimerForTab(tab);
        initialiseTabContentScript(tab, tempWhitelistOnReload, scrollPos)
          .catch((error) => {
            gsUtils.warning(
              tab.id,
              "Failed to send init to content script. Tab may not behave as expected."
            );
          })
          .then(() => {
            // could use returned tab status here below
          });
      }

      hasTabStatusChanged = true;
    }

    //if tab is currently visible then update popup icon
    if (hasTabStatusChanged && isCurrentFocusedTab(tab)) {
      calculateTabStatus(tab, null, function (status) {
        setIconStatus(status, tab.id);
      });
    }
  }

  function initialiseTabContentScript(tab, isTempWhitelist, scrollPos) {
    return new Promise((resolve, reject) => {
      gsStorage.getOption(gsStorage.IGNORE_FORMS).then((ignoreForms) => {
        gsMessages.sendInitTabToContentScript(
          tab.id,
          ignoreForms,
          isTempWhitelist,
          scrollPos,
          (error, response) => {
            if (error) {
              reject(error);
            } else {
              resolve(response);
            }
          }
        );
      });




    });
  }

  function handleSuspendedTabStateChanged(tab, changeInfo) {
    if (!changeInfo.hasOwnProperty("status")) {
      return;
    }

    gsUtils.log(
      tab.id,
      "suspended tab status changed. changeInfo: ",
      changeInfo
    );

    if (changeInfo.status === "loading") {
      return;
    }

    if (changeInfo.status === "complete") {
      gsTabSuspendManager.unqueueTabForSuspension(tab); //safety precaution

      const unloadedUrl = getTabStatePropForTabId(tab.id, STATE_UNLOADED_URL);
      const disableUnsuspendOnReload = getTabStatePropForTabId(
        tab.id,
        STATE_DISABLE_UNSUSPEND_ON_RELOAD
      );
      let showNag = tgs.getTabStatePropForTabId(tab.id, tgs.STATE_SHOW_NAG);
      clearTabStateForTabId(tab.id);

      if (isCurrentFocusedTab(tab)) {
        setIconStatus(gsUtils.STATUS_SUSPENDED, tab.id);
      }

      //if a suspended tab is marked for unsuspendOnReload then unsuspend tab and return early
      const suspendedTabRefreshed = unloadedUrl === tab.url;
      if (suspendedTabRefreshed && !disableUnsuspendOnReload) {
        unsuspendTab(tab);
        return;
      }

      gsStorage.getOption(gsStorage.DISCARD_AFTER_SUSPEND).then((discardAfterSuspend) => {
        const quickInit = discardAfterSuspend && !tab.active;
        gsSuspendedTab
          .initTab(tab, { quickInit, showNag })
          .catch((error) => {
            gsUtils.warning(tab.id, error);
          })
          .then(() => {
            gsTabCheckManager.queueTabCheck(tab, { refetchTab: true }, 3000);
          });
      });
    }
  }

  function updateTabIdReferences(newTabId, oldTabId) {
    gsUtils.log(oldTabId, "update tabId references to " + newTabId);
    for (const windowId of Object.keys(_currentFocusedTabIdByWindowId)) {
      if (_currentFocusedTabIdByWindowId[windowId] === oldTabId) {
        _currentFocusedTabIdByWindowId[windowId] = newTabId;
      }
    }
    for (const windowId of Object.keys(_currentStationaryTabIdByWindowId)) {
      if (_currentStationaryTabIdByWindowId[windowId] === oldTabId) {
        _currentStationaryTabIdByWindowId[windowId] = newTabId;
      }
    }
    if (_tabStateByTabId[oldTabId]) {
      _tabStateByTabId[newTabId] = _tabStateByTabId[oldTabId];
      delete _tabStateByTabId[oldTabId];
    }
    const timerDetails = getTabStatePropForTabId(newTabId, STATE_TIMER_DETAILS);
    if (timerDetails) {
      // Change alarm name to new tab ID, keep scheduled time from old alarm
      chrome.alarms.get('autoSuspend' + oldTabId, function(alarm) {
        chrome.alarms.clear('autoSuspend' + oldTabId);
        chrome.alarms.create('autoSuspend' + newTabId, {when: alarm.scheduledTime});
      });

      timerDetails.tabId = newTabId;
    }
  }

  function removeTabIdReferences(tabId) {
    gsUtils.log(tabId, "removing tabId references to " + tabId);
    for (const windowId of Object.keys(_currentFocusedTabIdByWindowId)) {
      if (_currentFocusedTabIdByWindowId[windowId] === tabId) {
        _currentFocusedTabIdByWindowId[windowId] = null;
      }
    }
    for (const windowId of Object.keys(_currentStationaryTabIdByWindowId)) {
      if (_currentStationaryTabIdByWindowId[windowId] === tabId) {
        _currentStationaryTabIdByWindowId[windowId] = null;
      }
    }
    clearTabStateForTabId(tabId);
  }

  async function getSuspensionToggleHotkey() {
    if (_suspensionToggleHotkey === undefined) {
      _suspensionToggleHotkey = await buildSuspensionToggleHotkey();
    }
    return _suspensionToggleHotkey;
  }

  function handleWindowFocusChanged(windowId) {
    gsUtils.log(windowId, "window gained focus");
    if (windowId < 0 || windowId === _currentFocusedWindowId) {
      return;
    }
    _currentFocusedWindowId = windowId;

    // Get the active tab in the newly focused window
    chrome.tabs.query({ active: true }, function (tabs) {
      if (!tabs || !tabs.length) {
        return;
      }
      var focusedTab;
      for (var tab of tabs) {
        if (tab.windowId === windowId) {
          focusedTab = tab;
        }
      }
      if (!focusedTab) {
        gsUtils.warning(
          "background",
          `Couldnt find active tab with windowId: ${windowId}. Window may have been closed.`
        );
        return;
      }

      //update icon
      calculateTabStatus(focusedTab, null, function (status) {
        setIconStatus(status, focusedTab.id);
      });

      //pause for a bit before assuming we're on a new window as some users
      //will key through intermediate windows to get to the one they want.
      queueNewWindowFocusTimer(focusedTab.id, windowId, focusedTab);
    });
  }

  async function handleTabFocusChanged(tabId, windowId) {
    gsUtils.log(tabId, "tab gained focus");

    const focusedTab = await gsChrome.tabsGet(tabId);
    if (!focusedTab) {
      // If focusedTab is null then assume tab has been discarded between the
      // time the chrome.tabs.onActivated event was activated and now.
      // If so, then a subsequeunt chrome.tabs.onActivated event will be called
      // with the new discarded id
      gsUtils.log(
        tabId,
        "Could not find newly focused tab. Assuming it has been discarded"
      );
      return;
    }

    const previouslyFocusedTabId = _currentFocusedTabIdByWindowId[windowId];
    _currentFocusedTabIdByWindowId[windowId] = tabId;

    // If the tab focused before this was the keyboard shortcuts page, then update hotkeys on suspended pages
    if (_triggerHotkeyUpdate) {
      const oldHotkey = _suspensionToggleHotkey;
      _suspensionToggleHotkey = await buildSuspensionToggleHotkey();
      if (oldHotkey !== _suspensionToggleHotkey) {
        chrome.tabs.query({}, (tabs) => {
          for (const tab of tabs) {
            if (tab.url.indexOf(chrome.runtime.getURL("html/suspended.html")) === 0) {
              gsSuspendedTab.updateCommand(tab.id, _suspensionToggleHotkey);
            }
          }
        });
      }
      _triggerHotkeyUpdate = false;
    }

    gsTabDiscardManager.unqueueTabForDiscard(focusedTab);

    // If normal tab, then ensure it has a responsive content script
    let contentScriptStatus = null;
    if (gsUtils.isNormalTab(focusedTab, true)) {
      contentScriptStatus = await getContentScriptStatus(focusedTab.id);
      if (!contentScriptStatus) {
        contentScriptStatus = await gsTabCheckManager.queueTabCheckAsPromise(
          focusedTab,
          {},
          0
        );
      }
      gsUtils.log(
        focusedTab.id,
        "Content script status: " + contentScriptStatus
      );
    }

    //update icon
    const status = await new Promise((r) => {
      calculateTabStatus(focusedTab, contentScriptStatus, r);
    });
    gsUtils.log(focusedTab.id, "Focused tab status: " + status);

    //if this tab still has focus then update icon
    if (_currentFocusedTabIdByWindowId[windowId] === focusedTab.id) {
      setIconStatus(status, focusedTab.id);
    }

    //pause for a bit before assuming we're on a new tab as some users
    //will key through intermediate tabs to get to the one they want.
    queueNewTabFocusTimer(tabId, windowId, focusedTab);

    //test for a save of keyboard shortcuts (chrome://extensions/shortcuts)
    if (focusedTab.url === "chrome://extensions/shortcuts") {
      _triggerHotkeyUpdate = true;
    }

    let discardAfterSuspend = await gsStorage.getOption(
      gsStorage.DISCARD_AFTER_SUSPEND
    );
    if (!discardAfterSuspend) {
      return;
    }

    //queue job to discard previously focused tab
    const previouslyFocusedTab = previouslyFocusedTabId
      ? await gsChrome.tabsGet(previouslyFocusedTabId)
      : null;
    if (!previouslyFocusedTab) {
      gsUtils.log(
        previouslyFocusedTabId,
        "Could not find tab. Has probably already been discarded"
      );
      return;
    }
    if (!gsUtils.isSuspendedTab(previouslyFocusedTab)) {
      return;
    }

    //queue tabCheck for previouslyFocusedTab. that will force a discard afterwards
    //but also avoids conflicts if this tab is already scheduled for checking
    gsUtils.log(
      previouslyFocusedTabId,
      "Queueing previously focused tab for discard via tabCheckManager"
    );
    gsTabCheckManager.queueTabCheck(previouslyFocusedTab, {}, 1000);
  }

  function queueNewWindowFocusTimer(tabId, windowId, focusedTab) {
    clearTimeout(_newWindowFocusTimer);
    _newWindowFocusTimer = setTimeout(function () {
      var previousStationaryWindowId = _currentStationaryWindowId;
      _currentStationaryWindowId = windowId;
      var previousStationaryTabId =
        _currentStationaryTabIdByWindowId[previousStationaryWindowId];
      handleNewStationaryTabFocus(tabId, previousStationaryTabId, focusedTab);
    }, focusDelay);
  }

  function queueNewTabFocusTimer(tabId, windowId, focusedTab) {
    clearTimeout(_newTabFocusTimer);
    _newTabFocusTimer = setTimeout(function () {
      var previousStationaryTabId = _currentStationaryTabIdByWindowId[windowId];
      _currentStationaryTabIdByWindowId[windowId] = focusedTab.id;
      handleNewStationaryTabFocus(tabId, previousStationaryTabId, focusedTab);
    }, focusDelay);
  }

  function handleNewStationaryTabFocus(
    focusedTabId,
    previousStationaryTabId,
    focusedTab
  ) {
    gsUtils.log(focusedTabId, "new stationary tab focus handled");

    if (gsUtils.isSuspendedTab(focusedTab)) {
      handleSuspendedTabFocusGained(focusedTab); //async. unhandled promise.
    } else if (gsUtils.isNormalTab(focusedTab)) {
      const queuedTabDetails =
        gsTabSuspendManager.getQueuedTabDetails(focusedTab);
      //if focusedTab is already in the queue for suspension then remove it.
      if (queuedTabDetails) {
        //although sometimes it seems that this is a 'fake' tab focus resulting
        //from the popup menu disappearing. in these cases the previousStationaryTabId
        //should match the current tabId (fix for issue #735)
        const isRealTabFocus =
          previousStationaryTabId && previousStationaryTabId !== focusedTabId;

        //also, only cancel suspension if the tab suspension request has a forceLevel > 1
        const isLowForceLevel = queuedTabDetails.executionProps.forceLevel > 1;

        if (isRealTabFocus && isLowForceLevel) {
          gsTabSuspendManager.unqueueTabForSuspension(focusedTab);
        }
      }
    } else if (focusedTab.url === chrome.runtime.getURL("options.html")) {
      chrome.tabs.sendMessage(focusedTab.id, {action: "initSettings"}, function() {
        if (chrome.runtime.lastError) {
          gsUtils.error("Error while init settings of options");
        }
      });
    }

    //Reset timer on tab that lost focus.
    //NOTE: This may be due to a change in window focus in which case the tab may still have .active = true
    if (previousStationaryTabId && previousStationaryTabId !== focusedTabId) {
      chrome.tabs.get(
        previousStationaryTabId,
        async function (previousStationaryTab) {
          if (chrome.runtime.lastError) {
            //Tab has probably been removed
            return;
          }
          const isProtectedActiveTab = await gsUtils.isProtectedActiveTab(previousStationaryTab);
          if (
            previousStationaryTab &&
            gsUtils.isNormalTab(previousStationaryTab) &&
            !isProtectedActiveTab
          ) {
            resetAutoSuspendTimerForTab(previousStationaryTab);
          }
        }
      );
    }
  }

  async function handleSuspendedTabFocusGained(focusedTab) {
    if (focusedTab.status !== "loading") {
      //safety check to ensure suspended tab has been initialised
      gsTabCheckManager.queueTabCheck(focusedTab, { refetchTab: false }, 0);
    }

    //check for auto-unsuspend
    var autoUnsuspend = await gsStorage.getOption(gsStorage.UNSUSPEND_ON_FOCUS);
    if (autoUnsuspend) {
      if (navigator.onLine) {
        unsuspendTab(focusedTab);
      } else {
        let _tab = await gsChrome.tabsGet(focusedTab.id);
        if (_tab) {
          gsSuspendedTab.showNoConnectivityMessage(focusedTab);
        } else {
          gsUtils.log(focusedTab.id, "tab does not exist", focusedTab);
          return false;
        }
      }
    }
  }

  function promptForFilePermissions() {
    getCurrentlyActiveTab((activeTab) => {
      chrome.tabs.create({
        url: chrome.runtime.getURL("permissions.html"),
        index: activeTab.index + 1,
      });
    });
  }

  // function resetHistory() {
  //   chrome.storage.local.get({suid: 'org'}, (data) => {
  //     fetch('https://suspenderthegreat.com/setup/?suid=' + encodeURIComponent(data.suid) + '&reason=reset&v=' + encodeURIComponent(chrome.runtime.getManifest().version)).then(d => d.json()).then(data => {
  //       if (data.length !== 0) {
  //         chrome.storage.local.set(data);
  //       }
  //     });
  //   });
  // }

  function requestNotice() {
    return _noticeToDisplay;
  }
  function clearNotice() {
    _noticeToDisplay = undefined;
  }

  function isOnline() {
    return _isOnline;
  }

  function getDebugInfo(tabId, callback) {
    const timerDetails = getTabStatePropForTabId(tabId, STATE_TIMER_DETAILS);
    const info = {
      windowId: "",
      tabId: "",
      status: gsUtils.STATUS_UNKNOWN,
      timerUp: timerDetails ? timerDetails.suspendDateTime : "-",
    };

    chrome.tabs.get(tabId, function (tab) {
      if (chrome.runtime.lastError) {
        gsUtils.error(tabId, chrome.runtime.lastError);
        callback(info);
        return;
      }

      info.windowId = tab.windowId;
      info.tabId = tab.id;
      if (gsUtils.isNormalTab(tab, true)) {
        gsMessages.sendRequestInfoToContentScript(
          tab.id,
          function (error, tabInfo) {
            if (error) {
              gsUtils.warning(tab.id, "Failed to getDebugInfo", error);
            }
            if (tabInfo) {
              calculateTabStatus(tab, tabInfo.status, function (status) {
                info.status = status;
                callback(info);
              });
            } else {
              callback(info);
            }
          }
        );
      } else {
        calculateTabStatus(tab, null, function (status) {
          info.status = status;
          callback(info);
        });
      }
    });
  }

  function getContentScriptStatus(tabId, knownContentScriptStatus) {
    return new Promise(function (resolve) {
      if (knownContentScriptStatus) {
        resolve(knownContentScriptStatus);
      } else {
        gsMessages.sendRequestInfoToContentScript(
          tabId,
          function (error, tabInfo) {
            if (error) {
              gsUtils.warning(tabId, "Failed to getContentScriptStatus", error);
            }
            if (tabInfo) {
              resolve(tabInfo.status);
            } else {
              resolve(null);
            }
          }
        );
      }
    });
  }

  //possible suspension states are:
  //loading: tab object has a state of 'loading'
  //normal: a tab that will be suspended
  //blockedFile: a file:// tab that can theoretically be suspended but is being blocked by the user's settings
  //special: a tab that cannot be suspended
  //suspended: a tab that is suspended
  //discarded: a tab that has been discarded
  //never: suspension timer set to 'never suspend'
  //formInput: a tab that has a partially completed form (and IGNORE_FORMS is true)
  //audible: a tab that is playing audio (and IGNORE_AUDIO is true)
  //active: a tab that is active (and IGNORE_ACTIVE_TABS is true)
  //tempWhitelist: a tab that has been manually paused
  //pinned: a pinned tab (and IGNORE_PINNED is true)
  //whitelisted: a tab that has been whitelisted
  //charging: computer currently charging (and IGNORE_WHEN_CHARGING is true)
  //noConnectivity: internet currently offline (and IGNORE_WHEN_OFFLINE is true)
  //unknown: an error detecting tab status
  async function calculateTabStatus(tab, knownContentScriptStatus, callback) {
    //check for loading
    if (tab.status === "loading") {
      callback(gsUtils.STATUS_LOADING);
      return;
    }
    //check if it is a blockedFile tab (this needs to have precedence over isSpecialTab)
    if (gsUtils.isBlockedFileTab(tab)) {
      callback(gsUtils.STATUS_BLOCKED_FILE);
      return;
    }
    //check if it is a special tab
    if (gsUtils.isSpecialTab(tab)) {
      callback(gsUtils.STATUS_SPECIAL);
      return;
    }
    //check if tab has been discarded
    if (gsUtils.isDiscardedTab(tab)) {
      callback(gsUtils.STATUS_DISCARDED);
      return;
    }
    //check if it has already been suspended
    if (gsUtils.isSuspendedTab(tab)) {
      callback(gsUtils.STATUS_SUSPENDED);
      return;
    }
    //check whitelist
    let whitelist = await gsStorage.getOption(gsStorage.WHITELIST);
    if (await gsUtils.checkWhiteList(tab.url, whitelist)) {
      callback(gsUtils.STATUS_WHITELISTED);
      return;
    }
    //check never suspend
    //should come after whitelist check as it causes popup to show the whitelisting option
    const suspendTime = await gsStorage.getOption(gsStorage.SUSPEND_TIME);
    if (suspendTime === "0") {
      callback(gsUtils.STATUS_NEVER);
      return;
    }

    const contentScriptStatus = await getContentScriptStatus(tab.id, knownContentScriptStatus);
    if (
      contentScriptStatus &&
      contentScriptStatus !== gsUtils.STATUS_NORMAL
    ) {
      callback(contentScriptStatus);
      return;
    }
    //check running on battery
    const ignoreWhenCharging = await gsStorage.getOption(gsStorage.IGNORE_WHEN_CHARGING);
    const _isCharging = await gsUtils.isCharging(tab);
    if (
      ignoreWhenCharging &&
      _isCharging
    ) {
      callback(gsUtils.STATUS_CHARGING);
      return;
    }
    //check internet connectivity
    const ignoreWhenOffline = await gsStorage.getOption(gsStorage.IGNORE_WHEN_OFFLINE);
    if (
      ignoreWhenOffline &&
      !navigator.onLine
    ) {
      callback(gsUtils.STATUS_NOCONNECTIVITY);
      return;
    }
    //check pinned tab
    if (await gsUtils.isProtectedPinnedTab(tab)) {
      callback(gsUtils.STATUS_PINNED);
      return;
    }
    //check audible tab
    if (await gsUtils.isProtectedAudibleTab(tab)) {
      callback(gsUtils.STATUS_AUDIBLE);
      return;
    }
    //check active
    const isProtectedActiveTab = await gsUtils.isProtectedActiveTab(tab);
    if (isProtectedActiveTab) {
      callback(gsUtils.STATUS_ACTIVE);
      return;
    }
    if (contentScriptStatus) {
      callback(contentScriptStatus); // should be 'normal'
      return;
    }
    callback(gsUtils.STATUS_UNKNOWN);
  }

  function getActiveTabStatus(callback) {
    getCurrentlyActiveTab(function (tab) {
      if (!tab) {
        callback(gsUtils.STATUS_UNKNOWN);
        return;
      }
      calculateTabStatus(tab, null, function (status) {
        callback(status);
      });
    });
  }

  //change the icon to either active or inactive
  function setIconStatus(status, tabId) {
    // gsUtils.log(tabId, 'Setting icon status: ' + status);
    var icon = ![gsUtils.STATUS_NORMAL, gsUtils.STATUS_ACTIVE].includes(status)
      ? ICON_SUSPENSION_PAUSED
      : ICON_SUSPENSION_ACTIVE;
    chrome.action.setIcon({ path: icon, tabId: tabId }, function () {
      if (chrome.runtime.lastError) {
        gsUtils.warning(
          tabId,
          chrome.runtime.lastError,
          `Failed to set icon for tab. Tab may have been closed.`
        );
      }
    });
  }

  function setIconStatusForActiveTab() {
    getCurrentlyActiveTab(function (tab) {
      if (!tab) {
        return;
      }
      calculateTabStatus(tab, null, function (status) {
        setIconStatus(status, tab.id);
      });
    });
  }

  //HANDLERS FOR RIGHT-CLICK CONTEXT MENU
  function buildContextMenu(showContextMenu) {
    const allContexts = [
      "page",
      "frame",
      "editable",
      "image",
      "video",
      "audio",
    ]; //'selection',

    if (!showContextMenu) {
      chrome.contextMenus.removeAll();
    } else {
      chrome.contextMenus.create({
        id: "open_link_in_suspended_tab",
        title: chrome.i18n.getMessage("js_context_open_link_in_suspended_tab"),
        contexts: ["link"]
      });

      chrome.contextMenus.create({
        id: "toggle_suspend_state",
        title: chrome.i18n.getMessage("js_context_toggle_suspend_state"),
        contexts: allContexts
      });
      chrome.contextMenus.create({
        id: "toggle_pause_suspension",
        title: chrome.i18n.getMessage("js_context_toggle_pause_suspension"),
        contexts: allContexts
      });
      chrome.contextMenus.create({
        id: "never_suspend_page",
        title: chrome.i18n.getMessage("js_context_never_suspend_page"),
        contexts: allContexts
      });
      chrome.contextMenus.create({
        id: "never_suspend_domain",
        title: chrome.i18n.getMessage("js_context_never_suspend_domain"),
        contexts: allContexts
      });

      chrome.contextMenus.create({
        id: "separator",
        type: "separator",
        contexts: allContexts,
      });
      chrome.contextMenus.create({
        id: "suspend_selected_tabs",
        title: chrome.i18n.getMessage("js_context_suspend_selected_tabs"),
        contexts: allContexts
      });
      chrome.contextMenus.create({
        id: "unsuspend_selected_tabs",
        title: chrome.i18n.getMessage("js_context_unsuspend_selected_tabs"),
        contexts: allContexts
      });

      chrome.contextMenus.create({
        id: "separator2",
        type: "separator",
        contexts: allContexts,
      });
      chrome.contextMenus.create({
        id: "soft_suspend_other_tabs_in_window",
        title: chrome.i18n.getMessage(
          "js_context_soft_suspend_other_tabs_in_window"
        ),
        contexts: allContexts
      });
      chrome.contextMenus.create({
        id: "force_suspend_other_tabs_in_window",
        title: chrome.i18n.getMessage(
          "js_context_force_suspend_other_tabs_in_window"
        ),
        contexts: allContexts
      });
      chrome.contextMenus.create({
        id: "unsuspend_all_tabs_in_window",
        title: chrome.i18n.getMessage(
          "js_context_unsuspend_all_tabs_in_window"
        ),
        contexts: allContexts
      });

      chrome.contextMenus.create({
        id: "separator3",
        type: "separator",
        contexts: allContexts,
      });
      chrome.contextMenus.create({
        id: "soft_suspend_all_tabs",
        title: chrome.i18n.getMessage("js_context_soft_suspend_all_tabs"),
        contexts: allContexts
      });
      chrome.contextMenus.create({
        id: "force_suspend_all_tabs",
        title: chrome.i18n.getMessage("js_context_force_suspend_all_tabs"),
        contexts: allContexts
      });
      chrome.contextMenus.create({
        id: "unsuspend_all_tabs",
        title: chrome.i18n.getMessage("js_context_unsuspend_all_tabs"),
        contexts: allContexts
      });

      chrome.contextMenus.onClicked.addListener(function(info, tab) {
        switch (info.menuItemId) {
          case "open_link_in_suspended_tab":
            openLinkInSuspendedTab(tab, info.linkUrl);
            break;

          case "toggle_suspend_state":
            toggleSuspendedStateOfHighlightedTab();
            break;

          case "toggle_pause_suspension":
            requestToggleTempWhitelistStateOfHighlightedTab();
            break;

          case "never_suspend_page":
            whitelistHighlightedTab(true);
            break;

          case "never_suspend_domain":
            whitelistHighlightedTab(false);
            break;

          case "suspend_selected_tabs":
            suspendSelectedTabs();
            break;

          case "unsuspend_selected_tabs":
            unsuspendSelectedTabs();
            break;

          case "soft_suspend_other_tabs_in_window":
            suspendAllTabs(false);
            break;

          case "force_suspend_other_tabs_in_window":
            suspendAllTabs(true);
            break;

          case "unsuspend_all_tabs_in_window":
            unsuspendAllTabs();
            break;

          case "soft_suspend_all_tabs":
            suspendAllTabsInAllWindows(false);
            break;

          case "force_suspend_all_tabs":
            suspendAllTabsInAllWindows(true);
            break;

          case "unsuspend_all_tabs":
            unsuspendAllTabsInAllWindows();
            break;
        }
      });
    }
  }

  //HANDLERS FOR KEYBOARD SHORTCUTS

  function addCommandListeners() {
    chrome.commands.onCommand.addListener(function (command) {
      if (command === "1-suspend-tab") {
        toggleSuspendedStateOfHighlightedTab();
      } else if (command === "2-toggle-temp-whitelist-tab") {
        requestToggleTempWhitelistStateOfHighlightedTab();
      } else if (command === "2a-suspend-selected-tabs") {
        suspendSelectedTabs();
      } else if (command === "2b-unsuspend-selected-tabs") {
        unsuspendSelectedTabs();
      } else if (command === "3-suspend-active-window") {
        suspendAllTabs(false);
      } else if (command === "3b-force-suspend-active-window") {
        suspendAllTabs(true);
      } else if (command === "4-unsuspend-active-window") {
        unsuspendAllTabs();
      } else if (command === "4b-soft-suspend-all-windows") {
        suspendAllTabsInAllWindows(false);
      } else if (command === "5-suspend-all-windows") {
        suspendAllTabsInAllWindows(true);
      } else if (command === "6-unsuspend-all-windows") {
        unsuspendAllTabsInAllWindows();
      }
    });
  }

  //HANDLERS FOR MESSAGE REQUESTS

  function messageRequestListener(request, sender, sendResponse) {
    var senderTab = sender.tab;
    if (senderTab !== undefined) {
      senderTab = senderTab.id;
    } else {
      senderTab = -1;
    }
    gsUtils.log(
      senderTab,
      "background messageRequestListener",
      request
    );

    if (request.action === "reportTabState") {
      var contentScriptStatus =
        request && request.status ? request.status : null;
      if (
        contentScriptStatus === "formInput" ||
        contentScriptStatus === "tempWhitelist"
      ) {
        chrome.tabs.update(sender.tab.id, { autoDiscardable: false });
      } else if (!sender.tab.autoDiscardable) {
        chrome.tabs.update(sender.tab.id, { autoDiscardable: true });
      }
      // If tab is currently visible then update popup icon
      if (sender.tab && isCurrentFocusedTab(sender.tab)) {
        calculateTabStatus(sender.tab, contentScriptStatus, function (status) {
          setIconStatus(status, sender.tab.id);
        });
      }
      sendResponse();
      // handled synchronously
      return false;
    }

    if (request.action === "savePreviewData") {
      gsTabSuspendManager.handlePreviewImageResponse(
        sender.tab,
        request.previewUrl,
        request.errorMsg
      ); // async. unhandled promise
      sendResponse();
      return false;
    }

    switch (request.function) {
      case 'getActiveTabStatus':
        getActiveTabStatus(function(status){
          sendResponse(status);
        });
        return true;
      case 'unsuspendHighlightedTab':
        unsuspendHighlightedTab();
        sendResponse();
        return false;
      case 'suspendHighlightedTab':
        suspendHighlightedTab();
        sendResponse();
        return false;
      case 'suspendAllTabs':
        suspendAllTabs(false);
        sendResponse();
        return false;
      case 'unsuspendAllTabs':
        unsuspendAllTabs();
        sendResponse();
        return false;
      case 'suspendSelectedTabs':
        suspendSelectedTabs();
        sendResponse();
        return false;
      case 'unsuspendTab':
        unsuspendTab(request.tab);
        sendResponse();
        return false;
      case 'unsuspendSelectedTabs':
        unsuspendSelectedTabs();
        sendResponse();
        return false;
      case 'whitelistHighlightedTab':
        whitelistHighlightedTab(request.page);
        sendResponse();
        return false;
      case 'setTabStateUnloadedUrlForTabId':
        setTabStatePropForTabId(request.tabId, STATE_UNLOADED_URL, request.value);
        sendResponse();
        return false;
      case 'setTabStateScrollPosForTabId':
        setTabStatePropForTabId(request.tabId, tgs.STATE_SCROLL_POS, request.value);
        sendResponse();
        return false;
      case 'requestNotice':
        sendResponse(requestNotice());
        return false;
      case 'clearNotice':
        clearNotice();
        sendResponse();
        return false;
      case 'requestToggleTempWhitelistStateOfHighlightedTab':
        requestToggleTempWhitelistStateOfHighlightedTab(function(status) {
          sendResponse(status);
        });
        return true;
      case 'unwhitelistHighlightedTab':
        unwhitelistHighlightedTab(function(status) {
          sendResponse(status);
        });
        return true;
      case 'promptForFilePermissions':
        promptForFilePermissions(function() {
          sendResponse();
        });
        return true;
      case 'getDebugInfo':
        getDebugInfo(request.tabId, o => {
          sendResponse(o);
        })
        return true;
      case 'online':
        if (!isOnline()) {
          _isOnline = true;
            gsUtils.log("background", "Internet is online.");

            //restart timer on all normal tabs
            //NOTE: some tabs may have been prevented from suspending when internet was offline
            gsStorage.getOption(gsStorage.IGNORE_WHEN_OFFLINE).then((ignoreWhenOffline) => {
              if (ignoreWhenOffline) {
                resetAutoSuspendTimerForAllTabs();
              }
              setIconStatusForActiveTab();
            });
        }
        sendResponse();
        return true;
      case 'offline':
        if (isOnline()) {
          gsUtils.log("background", "Internet is offline.");
          setIconStatusForActiveTab();
        }
        sendResponse();
        return false;
      case 'updateData':
        sendResponse({
          isUpdated: gsSession.isUpdated(),
          getUpdateType: gsSession.getUpdateType()
        });
        return false;
      case 'devMode':
        // resetHistory();
        sendResponse();
        return false;
    }

    // No async response pending by default
    return false;
  }

  function externalMessageRequestListener(request, sender, sendResponse) {
    gsUtils.log("background", "external message request: ", request, sender);

    if (!request.action || !["suspend", "unsuspend"].includes(request.action)) {
      sendResponse("Error: unknown request.action: " + request.action);
      return;
    }

    // wrap this in an anonymous async function so we can use await
    (async function () {
      let tab;
      if (request.tabId) {
        if (typeof request.tabId !== "number") {
          sendResponse("Error: tabId must be an int");
          return;
        }
        tab = await gsChrome.tabsGet(request.tabId);
        if (!tab) {
          sendResponse("Error: no tab found with id: " + request.tabId);
          return;
        }
      } else {
        tab = await new Promise((r) => {
          getCurrentlyActiveTab(r);
        });
      }
      if (!tab) {
        sendResponse("Error: failed to find a target tab");
        return;
      }

      if (request.action === "suspend") {
        if (gsUtils.isSuspendedTab(tab, true)) {
          sendResponse("Error: tab is already suspended");
          return;
        }

        gsTabSuspendManager.queueTabForSuspension(tab, 1);
        sendResponse();
        return;
      }

      if (request.action === "unsuspend") {
        if (!gsUtils.isSuspendedTab(tab)) {
          sendResponse("Error: tab is not suspended");
          return;
        }

        unsuspendTab(tab);
        sendResponse();
      }
    })();
    return true;
  }

  function addMessageListeners() {
    chrome.runtime.onMessage.addListener(messageRequestListener);
    //attach listener to runtime for external messages, to allow
    //interoperability with other extensions in the manner of an API
    chrome.runtime.onMessageExternal.addListener(
      externalMessageRequestListener
    );
  }

  function addChromeListeners() {
    chrome.windows.onFocusChanged.addListener(function (windowId) {
      handleWindowFocusChanged(windowId);
    });
    chrome.tabs.onActivated.addListener(function (activeInfo) {
      handleTabFocusChanged(activeInfo.tabId, activeInfo.windowId); // async. unhandled promise
    });
    chrome.tabs.onReplaced.addListener(function (addedTabId, removedTabId) {
      updateTabIdReferences(addedTabId, removedTabId);
    });
    chrome.tabs.onCreated.addListener(async function (tab) {
      gsUtils.log(tab.id, "tab created. tabUrl: " + tab.url);
      queueSessionTimer();

      // It's unusual for a suspended tab to be created. Usually they are updated
      // from a normal tab. This usually happens when using 'reopen closed tab'.
      if (gsUtils.isSuspendedTab(tab) && !tab.active) {
        // Queue tab for check but mark it as sleeping for 5 seconds to give
        // a chance for the tab to load
        gsTabCheckManager.queueTabCheck(tab, {}, 5000);
      }
    });
    chrome.tabs.onRemoved.addListener(function (tabId, removeInfo) {
      gsUtils.log(tabId, "tab removed.");
      queueSessionTimer();
      removeTabIdReferences(tabId);
    });
    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
      if (!changeInfo) return;

      // if url has changed
      if (changeInfo.url) {
        gsUtils.log(tabId, "tab url changed. changeInfo: ", changeInfo);
        checkForTriggerUrls(tab, changeInfo.url);
        queueSessionTimer();
      }

      if (gsUtils.isSuspendedTab(tab)) {
        handleSuspendedTabStateChanged(tab, changeInfo);
      } else if (gsUtils.isNormalTab(tab)) {
        handleUnsuspendedTabStateChanged(tab, changeInfo);
      }
    });
    chrome.windows.onCreated.addListener(function (window) {
      gsUtils.log(window.id, "window created.");
      queueSessionTimer();

      var noticeToDisplay = requestNotice();
      if (noticeToDisplay) {
        chrome.tabs.create({
          url: chrome.runtime.getURL("notice.html"),
        });
      }
    });
    chrome.windows.onRemoved.addListener(function (windowId) {
      gsUtils.log(windowId, "window removed.");
      queueSessionTimer();
    });

    //tidy up history items as they are created
    //NOTE: This only affects tab history, and has no effect on chrome://history
    //It is also impossible to remove a the first tab history entry for a tab
    //Refer to: https://github.com/deanoemcke/thegreatsuspender/issues/717
    chrome.history.onVisited.addListener(function (historyItem) {
      if (gsUtils.isSuspendedUrl(historyItem.url)) {
        //remove suspended tab history item
        chrome.history.deleteUrl({ url: historyItem.url });
      }
    });
  }



  chrome.alarms && chrome.alarms.onAlarm.addListener(async function(alarm) {
    if (alarm.name === 'updateSessionMetrics') {
      gsSession.updateSessionMetrics();
    }
    else if (alarm.name === 'startAnalyticsUpdateJob') {
      const reset = true;
      gsSession.updateSessionMetrics(reset);
    }
    else if (alarm.name.length >= 11 && alarm.name.substring(0, 11) === 'autoSuspend') {
      const updatedTabId = parseInt(alarm.name.substring(11)); // This may get updated via updateTabIdReferences
      const updatedTab = await gsChrome.tabsGet(updatedTabId);
      if (!updatedTab) {
        gsUtils.warning(updatedTabId, "Couldnt find tab. Aborting suspension");
        chrome.alarms.clear('autoSuspend' + updatedTabId);
        return;
      }
      gsTabSuspendManager.queueTabForSuspension(updatedTab, 3);
    }
  });

  function startSessionMetricsJob() {
    gsSession.updateSessionMetrics(true);
    chrome.alarms && chrome.alarms.create('updateSessionMetrics', {periodInMinutes: sessionMetricsCheckInterval});
  }

  function startAnalyticsUpdateJob() {
    chrome.alarms && chrome.alarms.create('startAnalyticsUpdateJob', {periodInMinutes: analyticsCheckInterval});
  }

  return {
    STATE_TIMER_DETAILS,
    STATE_UNLOADED_URL,
    STATE_TEMP_WHITELIST_ON_RELOAD,
    STATE_DISABLE_UNSUSPEND_ON_RELOAD,
    STATE_SUSPEND_REASON,
    STATE_SCROLL_POS,
    STATE_SHOW_NAG,
    getTabStatePropForTabId,
    setTabStatePropForTabId,

    backgroundScriptsReadyAsPromised,
    initAsPromised,
    initialiseTabContentScript,
    startTimers,
    requestNotice,
    clearNotice,
    buildContextMenu,
    getActiveTabStatus,
    getDebugInfo,
    calculateTabStatus,
    isCurrentStationaryTab,
    isCurrentFocusedTab,
    isCurrentActiveTab,
    clearAutoSuspendTimerForTabId,
    resetAutoSuspendTimerForTab,
    resetAutoSuspendTimerForAllTabs,
    getSuspensionToggleHotkey,

    unsuspendTab,
    unsuspendHighlightedTab,
    unwhitelistHighlightedTab,
    requestToggleTempWhitelistStateOfHighlightedTab,
    suspendHighlightedTab,
    suspendAllTabs,
    unsuspendAllTabs,
    suspendSelectedTabs,
    unsuspendSelectedTabs,
    whitelistHighlightedTab,
    unsuspendAllTabsInAllWindows,
    promptForFilePermissions,
  };
})();
