/*global chrome, gsStorage, gsChrome, gsUtils */

import {gsStorage} from "./helpers/gsStorage.js";
import {gsChrome} from "./helpers/gsChrome.js";
import {gsUtils} from "./helpers/gsUtils.js";

(function() {
  var elementPrefMap = {
    preview: gsStorage.SCREEN_CAPTURE,
    forceScreenCapture: gsStorage.SCREEN_CAPTURE_FORCE,
    suspendInPlaceOfDiscard: gsStorage.SUSPEND_IN_PLACE_OF_DISCARD,
    onlineCheck: gsStorage.IGNORE_WHEN_OFFLINE,
    batteryCheck: gsStorage.IGNORE_WHEN_CHARGING,
    unsuspendOnFocus: gsStorage.UNSUSPEND_ON_FOCUS,
    discardAfterSuspend: gsStorage.DISCARD_AFTER_SUSPEND,
    dontSuspendPinned: gsStorage.IGNORE_PINNED,
    dontSuspendForms: gsStorage.IGNORE_FORMS,
    dontSuspendAudio: gsStorage.IGNORE_AUDIO,
    dontSuspendActiveTabs: gsStorage.IGNORE_ACTIVE_TABS,
    ignoreCache: gsStorage.IGNORE_CACHE,
    addContextMenu: gsStorage.ADD_CONTEXT,
    syncSettings: gsStorage.SYNC_SETTINGS,
    timeToSuspend: gsStorage.SUSPEND_TIME,
    theme: gsStorage.THEME,
    whitelist: gsStorage.WHITELIST,
  };

  function selectComboBox(element, key) {
    var i, child;

    for (i = 0; i < element.children.length; i += 1) {
      child = element.children[i];
      if (child.value === key) {
        child.selected = 'true';
        break;
      }
    }
  }

  //populate settings from synced storage
  async function initSettings() {
    var optionEls = document.getElementsByClassName('option'),
      pref,
      element,
      i,
      option;

    for (i = 0; i < optionEls.length; i++) {
      element = optionEls[i];
      pref = elementPrefMap[element.id];
      option = await gsStorage.getOption(pref);
      // If updated from an old version that 20 seconds (0.33 minute) suspend time was an option, change to 1 minute
      if (element.id === 'timeToSuspend' && option === '0.33') {
        gsStorage.setOptionAndSync(pref, '1');
        option = '1';
      }
      populateOption(element, option);
    }

    const screenCapture = await gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
    setForceScreenCaptureVisibility(
      screenCapture !== '0'
    );
    let suspendTime = await gsStorage.getOption(gsStorage.SUSPEND_TIME);
    setAutoSuspendOptionsVisibility(
      parseFloat(suspendTime) > 0
    );
    const syncSettings = await gsStorage.getOption(gsStorage.SYNC_SETTINGS);
    setSyncNoteVisibility(!syncSettings);

    let searchParams = new URL(location.href).searchParams;
    if (searchParams.has('firstTime')) {
      document
        .querySelector('.welcome-message')
        .classList.remove('reallyHidden');
      document.querySelector('#options-heading').classList.add('reallyHidden');
    }
  }

  function populateOption(element, value) {
    if (
      element.tagName === 'INPUT' &&
      element.hasAttribute('type') &&
      element.getAttribute('type') === 'checkbox'
    ) {
      element.checked = value;
    } else if (element.tagName === 'SELECT') {
      selectComboBox(element, value);
    } else if (element.tagName === 'TEXTAREA') {
      element.value = value;
    }
  }

  function getOptionValue(element) {
    if (
      element.tagName === 'INPUT' &&
      element.hasAttribute('type') &&
      element.getAttribute('type') === 'checkbox'
    ) {
      return element.checked;
    }
    if (element.tagName === 'SELECT') {
      return element.children[element.selectedIndex].value;
    }
    if (element.tagName === 'TEXTAREA') {
      return element.value;
    }
  }

  function setForceScreenCaptureVisibility(visible) {
    if (visible) {
      document.getElementById('forceScreenCaptureContainer').style.display =
        'block';
    } else {
      document.getElementById('forceScreenCaptureContainer').style.display =
        'none';
    }
  }

  function setSyncNoteVisibility(visible) {
    if (visible) {
      document.getElementById('syncNote').style.display = 'block';
    } else {
      document.getElementById('syncNote').style.display = 'none';
    }
  }

  function setAutoSuspendOptionsVisibility(visible) {
    Array.prototype.forEach.call(
      document.getElementsByClassName('autoSuspendOption'),
      function(el) {
        if (visible) {
          el.style.display = 'block';
        } else {
          el.style.display = 'none';
        }
      }
    );
  }

  function handleChange(element) {
    return async function() {
      var pref = elementPrefMap[element.id],
        interval;

      //add specific screen element listeners
      if (pref === gsStorage.SCREEN_CAPTURE) {
        setForceScreenCaptureVisibility(getOptionValue(element) !== '0');
      } else if (pref === gsStorage.SUSPEND_TIME) {
        interval = getOptionValue(element);
        setAutoSuspendOptionsVisibility(interval > 0);
      } else if (pref === gsStorage.SYNC_SETTINGS) {
        // we only really want to show this on load. not on toggle
        if (getOptionValue(element)) {
          setSyncNoteVisibility(false);
        }
      }

      var [oldValue, newValue] = await saveChange(element);
      if (oldValue !== newValue) {
        var prefKey = elementPrefMap[element.id];
        gsUtils.performPostSaveUpdates(
          [prefKey],
          { [prefKey]: oldValue },
          { [prefKey]: newValue }
        );
      }
    };
  }

  async function saveChange(element) {
    var pref = elementPrefMap[element.id],
      oldValue = await gsStorage.getOption(pref),
      newValue = getOptionValue(element);

    //clean up whitelist before saving
    if (pref === gsStorage.WHITELIST) {
      newValue = gsUtils.cleanupWhitelist(newValue);
    }

    //save option
    if (oldValue !== newValue) {
      await gsStorage.setOptionAndSync(elementPrefMap[element.id], newValue);
    }

    return [oldValue, newValue];
  }

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(async function() {
    await initSettings();

    var optionEls = document.getElementsByClassName('option'),
      element,
      i;

    //add change listeners for all 'option' elements
    for (i = 0; i < optionEls.length; i++) {
      element = optionEls[i];
      if (element.tagName === 'TEXTAREA') {
        element.addEventListener(
          'input',
          gsUtils.debounce(handleChange(element), 200),
          false
        );
      } else {
        element.onchange = handleChange(element);
      }
    }

    document.getElementById('testWhitelistBtn').onclick = async e => {
      e.preventDefault();
      const tabs = await gsChrome.tabsQuery();
      let whitelist = await gsStorage.getOption(gsStorage.WHITELIST);
      const tabUrls = tabs
        .map(
          tab =>
            gsUtils.isSuspendedTab(tab)
              ? gsUtils.getOriginalUrl(tab.url)
              : tab.url
        )
        .filter(
          url => !gsUtils.isSuspendedUrl(url) && gsUtils.checkWhiteList(url, whitelist)
        )
        .map(url => (url.length > 55 ? url.substr(0, 52) + '...' : url));
      if (tabUrls.length === 0) {
        alert(chrome.i18n.getMessage('js_options_whitelist_no_matches'));
        return;
      }
      const firstUrls = tabUrls.splice(0, 22);
      let alertString = `${chrome.i18n.getMessage(
        'js_options_whitelist_matches_heading'
      )}\n${firstUrls.join('\n')}`;

      if (tabUrls.length > 0) {
        alertString += `\n${chrome.i18n.getMessage(
          'js_options_whitelist_matches_overflow_prefix'
        )} ${tabUrls.length} ${chrome.i18n.getMessage(
          'js_options_whitelist_matches_overflow_suffix'
        )}`;
      }
      alert(alertString);
    };

    //hide incompatible sidebar items if in incognito mode
    if (chrome.extension.inIncognitoContext) {
      Array.prototype.forEach.call(
        document.getElementsByClassName('noIncognito'),
        function(el) {
          el.style.display = 'none';
        }
      );
      window.alert(chrome.i18n.getMessage('js_options_incognito_warning'));
    }
  });

  chrome.runtime.onMessage.addListener(function(
      request,
      sender,
      sendResponse
    ) {
      var senderTab = sender.tab;
      if (senderTab !== undefined) {
        senderTab = senderTab.id;
      } else {
        senderTab = -1;
      }
      gsUtils.log(
        senderTab,
        "options message listener",
        request.action
      );

      if (request.hasOwnProperty('action')) {
        if (request.action === 'initSettings') {
          initSettings().then(() => {
              sendResponse();
            });
          
          return true;
        }
      }

      return true;
    });
})();