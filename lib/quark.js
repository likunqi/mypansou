function listDir(dirFid, cookie) {
  return api('GET', '/1/clouddrive/file?pr=ucpro&fr=pc&pdir_fid=' + (dirFid || '0') + '&size=100', cookie, null).then(function(r) {
    if (r.data && r.data.data && r.data.data.list) {
      return r.data.data.list.filter(function(f) { return f.fid && f.file_type !== 0; });
    }
    return [];
  });
}function listDir(dirFid, cookie) {
  return api('POST', '/1/clouddrive/file/sort?pr=ucpro&fr=pc&__t=' + Date.now(), cookie, {
    pdir_fid: dirFid || '0', sort_by: 'file_name', sort_ascending: true, size: 100
  }).then(function(r) {
    if (r.data && r.data.data && r.data.data.list) {
      return r.data.data.list.filter(function(f) { return f.fid && !f.dir; });
    }
    return [];
  });
}

module.exports = { transfer, getShareInfo, saveFiles, createShare, parseUrl, ensureDir, listDir };