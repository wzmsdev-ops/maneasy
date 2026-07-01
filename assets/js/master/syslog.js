'use strict';

var _grid = null;
var _state = { page:1, pageSize:20, totalPages:1, loading:false };

function val(id) { return (document.getElementById(id)?.value || '').trim(); }
function fmtDt(v) { return v ? String(v).replace('T',' ').slice(0,16) : '-'; }

var ACTION_LABEL = {
  LOGIN:'로그인', SIGNAGE_CREATE:'사인물 신청', SIGNAGE_STATUS:'상태 변경',
  NOTICE_CREATE:'공지 작성', NOTICE_UPDATE:'공지 수정', NOTICE_DELETE:'공지 삭제',
};

function initGrid() {
  _grid = createMgGrid('logGrid', [
    { headerName:'일시', field:'created_at', width:155,
      cellRenderer: function(p) { return fmtDt(p.value); }
    },
    { headerName:'액션', field:'action', width:110,
      cellRenderer: function(p) {
        var cls = 'log-badge log-' + (p.value || '');
        var label = ACTION_LABEL[p.value] || p.value;
        return '<span class="' + cls + '">' + label + '</span>';
      }
    },
    { headerName:'사용자', field:'user_name', width:100 },
    { headerName:'내용', field:'description', flex:1, minWidth:200,
      headerClass:'ag-left-header',
      cellStyle:{ display:'flex', alignItems:'center', justifyContent:'flex-start' },
    },
    { headerName:'대상', field:'target_type', width:130,
      cellRenderer: function(p) {
        if (!p.value) return '-';
        var map = { signage_request:'사인물 신청', system_notice:'공지사항' };
        return map[p.value] || p.value;
      }
    },
  ], [], { noRowsText: '로그가 없습니다.' });
}

async function loadLogs(page) {
  if (_state.loading) return;
  _state.loading = true;
  page = page || _state.page;
  showGlobalLoading('로그를 불러오는 중...');

  var from    = val('logFrom');
  var to      = val('logTo');
  var action  = val('logAction');
  var keyword = val('logKeyword');
  var offset  = (page - 1) * _state.pageSize;

  var q = supabaseClient.from('system_logs').select('*', { count:'exact' })
    .order('created_at', { ascending:false })
    .range(offset, offset + _state.pageSize - 1);

  if (from)    q = q.gte('created_at', from);
  if (to)      q = q.lte('created_at', to + 'T23:59:59');
  if (action)  q = q.eq('action', action);
  if (keyword) q = q.or('user_name.ilike.%' + keyword + '%,description.ilike.%' + keyword + '%');

  var { data, error, count } = await q;
  hideGlobalLoading();
  _state.loading = false;

  if (error) { alert('로드 실패: ' + error.message); return; }
  _state.page = page;
  _state.totalPages = Math.max(1, Math.ceil((count || 0) / _state.pageSize));

  var label = document.getElementById('logCountLabel');
  if (label) label.textContent = '총 ' + (count || 0) + '건';

  updateMgGrid(_grid, data || []);
  renderPagination();
}

function renderPagination() {
  var el = document.getElementById('logPagination');
  if (!el) return;
  var page = _state.page, total = _state.totalPages;
  if (total <= 1) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  var bs = Math.floor((page-1)/10)*10+1, end = Math.min(total, bs+9);
  var pages = [];
  for (var i = bs; i <= end; i++)
    pages.push('<button class="pagination-btn' + (i===page?' is-active':'') + '" data-page="' + i + '">' + i + '</button>');
  el.innerHTML =
    '<button class="pagination-btn" data-page="' + Math.max(1,bs-1) + '"' + (bs<=1?' disabled':'') + '>이전</button>' +
    pages.join('') +
    '<button class="pagination-btn" data-page="' + Math.min(total,end+1) + '"' + (end>=total?' disabled':'') + '>다음</button>';
  el.querySelectorAll('.pagination-btn[data-page]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var p = Number(btn.dataset.page);
      if (p && p !== _state.page) loadLogs(p);
    });
  });
}

async function init() {
  var session = await auth.requireAuth();
  if (!session) return;

  var today = new Date();
  var weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
  document.getElementById('logFrom').value = weekAgo.toISOString().slice(0,10);
  document.getElementById('logTo').value   = today.toISOString().slice(0,10);

  initGrid();
  document.getElementById('logSearchBtn')?.addEventListener('click', function() { loadLogs(1); });
  document.getElementById('logKeyword')?.addEventListener('keydown', function(e) { if (e.key==='Enter') loadLogs(1); });

  await loadLogs(1);
}

document.addEventListener('DOMContentLoaded', init);
