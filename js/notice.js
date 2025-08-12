/*global chrome, gsStorage, gsUtils */

import {gsUtils} from "./helpers/gsUtils.js";
import {gsStorage} from "./helpers/gsStorage.js";

(function() {
  'use strict';

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    chrome.runtime.sendMessage({function: 'requestNotice'}, function (notice) {
      if (chrome.runtime.lastError) {
        gsUtils.error("Error while requesting notice", chrome.runtime.lastError);
      } else {
        if (
          notice &&
          notice.hasOwnProperty('text') &&
          notice.hasOwnProperty('version')
        ) {
          var noticeContentEl = document.getElementById('gsNotice');
          noticeContentEl.innerHTML = notice.text;
          //update local notice version
          gsStorage.setNoticeVersion(notice.version);
        }

        //clear notice (to prevent it showing again)
        chrome.runtime.sendMessage({function: 'clearNotice'}, function () {
          if (chrome.runtime.lastError) {
            gsUtils.error("Error while clearing notice", tab, chrome.runtime.lastError);
          }
        });
      }
    });
  });
})();
