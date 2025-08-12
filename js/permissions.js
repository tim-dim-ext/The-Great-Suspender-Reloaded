/*global chrome, historyUtils, gsSession, gsChrome, gsUtils */

import {historyUtils} from "./historyUtils.js";
import {gsSession} from "./helpers/gsSession.js";
import {gsChrome} from "./helpers/gsChrome.js";
import {gsUtils} from "./helpers/gsUtils.js";

(function(global) {
  'use strict';

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    document.getElementById('exportBackupBtn').onclick = async function(e) {
      const currentSession = await gsSession.buildCurrentSession();
      historyUtils.exportSession(currentSession, function() {
        document.getElementById('exportBackupBtn').style.display = 'none';
      });
    };
    document.getElementById('setFilePermissiosnBtn').onclick = async function(
      e
    ) {
      await gsChrome.tabsCreate({
        url: 'chrome://extensions?id=' + chrome.runtime.id,
      });
    };
  });

})(this);
