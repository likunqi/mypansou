var https = require('https');

function api(method, path, cookie, body, hostname) {
  return new Promise(function(resolve, reject) {
    if (!hostname) hostname = 'drive-h.quark.cn';
    var opts = {
      hostname: hostname,
      path: path,
      method: method,
      headers: {
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/3.14.2 Chrome/112.0.5615.165 Electron/24.1.3.8 Safari/537.36 Channel/pckk_other_ch',
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*'
      }
    };
    var req = https.request(opts, function(r) {
      var d = '';
      r.on('data', function(c) { d += c; });
      r.on('end', function() {
        try { resolve({ status: r.statusCode, data: JSON.parse(d) }); }
        catch(e) { reject(new Error('parse failed: ' + d.substring(0,200))); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function parseUrl(url) {
  var m = url.match(/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

function getShareInfo(shareCode, passcode, cookie) {
  var shareStoken;
  return api('POST', '/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc&__t=' + Date.now(), cookie, { pwd_id: shareCode, passcode: passcode || '' }).then(function(r) {
    if (r.data && r.data.status === 200 && r.data.data) {
      var info = r.data.data;
      shareStoken = info.stoken;
      if (info.stoken) {
        return api('GET', '/1/clouddrive/share/sharepage/detail?pr=ucpro&fr=pc&pwd_id=' + shareCode + '&stoken=' + encodeURIComponent(info.stoken) + '&__t=' + Date.now(), cookie);
      }
      throw new Error('no stoken');
    }
    throw new Error(r.data ? r.data.message : 'getShareInfo failed');
  }).then(function(r) {
    if (r.data && r.data.data && r.data.data.list) {
      return {
        files: r.data.data.list.filter(function(f) { return f.fid; }).map(function(f) {
          return { fid: f.fid, name: f.file_name, token: f.share_fid_token, type: f.file_type };
        }),
        stoken: shareStoken || ''
      };
    }
    throw new Error('no files found');
  });
}

function saveFiles(shareCode, fids, fidTokens, folderId, stoken, cookie) {
  return api('POST', '/1/clouddrive/share/sharepage/save?pr=ucpro&fr=pc&__t=' + Date.now(), cookie, {
    fid_list: fids,
    fid_token_list: fidTokens,
    to_pdir_fid: folderId || '0',
    pwd_id: shareCode,
    stoken: stoken || '',
    pdir_fid: '0',
    scene: 'link'
  }).then(function(r) {
    if (r.data && r.data.status === 200) { return r.data.data || { saved: true }; }
    throw new Error('save failed: ' + (r.data ? r.data.message : ''));
  });
}

function createShare(fid, cookie, retries) {
    if (retries === undefined) retries = 2;
  return api("POST", "/1/clouddrive/share?pr=ucpro&fr=pc&__t=" + Date.now(), cookie, {
    fid_list: [fid],
    pwd_id: "",
    url_type: 1,
    expired_type: 1,
    stoken: ""
  }, "drive-pc.quark.cn").then(function(r) {
    if (r.data && r.data.status === 200 && r.data.data) {
      var shareData = r.data.data;
      // Old API: share_id returned directly
      if (shareData.share_id) {
        var shareUrl = shareData.share_url || "https://pan.quark.cn/s/" + shareData.share_id;
        return { url: shareUrl, shareId: shareData.share_id, pwd: shareData.share_pwd || "" };
      }
      // New API: async task, poll then get URL from share list
      if (shareData.task_id) {
        return queryTask(shareData.task_id, cookie).then(function(taskResult) {
          console.error("createShare task result:", JSON.stringify(taskResult).slice(0,500));
          if (taskResult && taskResult.share_id) {
            // Query share list to get actual share URL
            var https = require("https");
            return new Promise(function(res) {
              var opts = {
                hostname: "drive-pc.quark.cn",
                path: "/1/clouddrive/share/mypage/detail?pr=ucpro&fr=pc&uc_param_str=&share_id=" + taskResult.share_id + "&__t=" + Date.now(),
                method: "GET",
                headers: {
                  "Cookie": cookie,
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  "Accept": "application/json, text/plain, */*",
                  "Referer": "https://pan.quark.cn/",
                  "Origin": "https://pan.quark.cn"
                }
              };
              https.get(opts, function(r2){
                var d="";r2.on("data",function(c){d+=c});r2.on("end",function(){
                  try{var j2=JSON.parse(d);
                    if(j2.status===200 && j2.data && j2.data.list){
                      for(var si=0;si<j2.data.list.length;si++){
                        var item=j2.data.list[si];
                        if(item.share_id === taskResult.share_id && item.share_url){
                          return res({url:item.share_url,shareId:item.share_id,pwd:item.share_pwd||""});
                        }
                      }
                      if(j2.data.list[0] && j2.data.list[0].share_url){
                        return res({url:j2.data.list[0].share_url,shareId:j2.data.list[0].share_id,pwd:j2.data.list[0].share_pwd||""});
                      }
                    }
                  }catch(e){}
                  if (retries > 0) {
                    setTimeout(function(){res(createShare(fid, cookie, retries - 1));}, 1000);
                  } else {
                    throw new Error("创建分享失败");
                  }
                });
              });
            });
          }
          if (retries > 0) {
            return new Promise(function(r2) { setTimeout(r2, 1000); }).then(function() {
              return createShare(fid, cookie, retries - 1);
            });
          }
          throw new Error("创建分享失败");
        });
      }
    }
    if (retries > 0) {
      return new Promise(function(r2) { setTimeout(r2, 1000); }).then(function() {
        return createShare(fid, cookie, retries - 1);
      });
    }
    throw new Error("create share failed");
  });
}
function ensureDir(cookie, dirName, parentFid) {
  parentFid = parentFid || '0';
  return api('GET', '/1/clouddrive/file?pr=ucpro&fr=pc&pdir_fid=' + parentFid + '&size=100&__t=' + Date.now(), cookie, null).then(function(r) {
    if (r.data && r.data.data && r.data.data.list) {
      var found = r.data.data.list.find(function(f) { return f.file_name === dirName && f.file_type === 0; });
      if (found) return found.fid;
    }
    return api('POST', '/1/clouddrive/file?pr=ucpro&fr=pc&__t=' + Date.now(), cookie, {
      pdir_fid: parentFid,
      file_name: dirName,
      dir_init_lock: false
    }).then(function(r2) {
      if (r2.data && r2.data.status === 200 && r2.data.data) { return r2.data.data.fid; }
      throw new Error('create dir failed');
    });
  });
}

function listDir(dirFid, cookie) {
  return api('GET', '/1/clouddrive/file?pr=ucpro&fr=pc&pdir_fid=' + (dirFid || '0') + '&size=100&__t=' + Date.now(), cookie, null).then(function(r) {
    if (r.data && r.data.data && r.data.data.list) { return r.data.data.list; }
    return [];
  });
}

function queryTask(taskId, cookie) {
  var retries = 0;
  function poll() {
    return api('GET', '/1/clouddrive/task?pr=ucpro&fr=pc&task_id=' + taskId + '&retry_index=' + retries + '&__t=' + Date.now(), cookie, null).then(function(r) {
      if (r.data && r.data.status === 200 && r.data.data) {
        if (r.data.data.status === 2) { return r.data.data; }
      }
      retries++;
      if (retries > 60) throw new Error('task timeout');
      return new Promise(function(resolve) { setTimeout(function() { resolve(poll()); }, 500); });
    });
  }
  return poll();
}

function wait(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function transfer(url, cookie) {
  // 1. Extract share code from URL
  var shareCode = parseUrl(url);
  if (!shareCode) throw new Error('Invalid Quark URL: ' + url);

  // 2. Get share info - try without passcode first, extract from URL if needed
  var passcode = '';
  var pwdMatch = url.match(/[?&]pwd=([^&]+)/);
  if (pwdMatch) passcode = pwdMatch[1];

  var shareInfo = await getShareInfo(shareCode, passcode, cookie);
  if (!shareInfo || !shareInfo.files || shareInfo.files.length === 0) {
    throw new Error('No files found in share');
  }

  var files = shareInfo.files;
  var stoken = shareInfo.stoken;

  // 3. Ensure 'pansou' directory exists in root
  var pansouFid = await ensureDir(cookie, 'pansou', '0');

  // 4. Save files to pansou directory
  var fids = files.map(function(f) { return f.fid; });
  var tokens = files.map(function(f) { return f.token; });
  var saveResult = await saveFiles(shareCode, fids, tokens, pansouFid, stoken, cookie);

  // 5. If save returned a task_id, poll for completion
  if (saveResult && saveResult.task_id) {
    await queryTask(saveResult.task_id, cookie);
  } else {
    // Brief wait for async processing
    await wait(2000);
  }

  // 6. List pansou directory to find saved files
  var dirFiles = await listDir(pansouFid, cookie);
  var savedFiles = dirFiles.filter(function(f) { return f.fid; });

  if (savedFiles.length === 0) {
    throw new Error('No files found after save');
  }

  // 7. Create new share link from the first saved file
  var targetFile = savedFiles[0];
  var shareResult;
  try { shareResult = await createShare(targetFile.fid, cookie); } catch(e) { console.error("createShare threw:", e.message); }
  if (!shareResult || !shareResult.url) {
    var dirAfter = await listDir(pansouFid, cookie);
    console.error("listDir after share RAW:", JSON.stringify(dirAfter).slice(0,3000));
    var sf = dirAfter.find(function(f) { return f.share_url; });
    if (sf && sf.share_url) { shareResult = { url: sf.share_url, shareId: sf.share_id, pwd: sf.share_pwd || "" }; }
  }
  if (!shareResult || !shareResult.url) throw new Error("创建分享链接失败");

  return {
    url: shareResult.url,
    pwd: shareResult.pwd || '',
    saved: true,
    fileName: targetFile.file_name || ''
  };
}

module.exports = { transfer, getShareInfo, saveFiles, createShare, parseUrl, ensureDir, listDir, queryTask };

