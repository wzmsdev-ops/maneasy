'use strict';

var _grid = null;
var _editingId = null;
var currentUser = null;

function ts(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function val(id) { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v ?? ''; }
function openModal(id)  { document.getElementById(id)?.classList.add('is-open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('is-open'); }
window.closeModal = closeModal;

function initGrid() {
  _grid = createMgGrid('noticeGrid', [
    { headerName:'작성일', field:'created_at', width:110,
      cellRenderer: function(p) { return p.value ? String(p.value).slice(0,10) : '-'; }
    },
    { headerName:'고정', field:'is_pinned', width:70,
      cellRenderer: function(p) { return p.value ? '<span class="badge-pin">고정</span>' : ''; }
    },
    { headerName:'상태', field:'is_active', width:80,
      cellRenderer: function(p) {
        return p.value ? '<span class="badge-active">게시 중</span>' : '<span class="badge-inactive">숨김</span>';
      }
    },
    { headerName:'제목', field:'title', flex:1, minWidth:200,
      headerClass:'ag-left-header',
      cellStyle:{ display:'flex', alignItems:'center', justifyContent:'flex-start' },
    },
    { headerName:'내용', field:'content', flex:2, minWidth:200,
      headerClass:'ag-left-header',
      cellStyle:{ display:'flex', alignItems:'center', justifyContent:'flex-start', color:'#6b7280' },
      cellRenderer: function(p) {
        return ts((p.value || '').replace(/\n/g,' ').slice(0, 80));
      }
    },
    { headerName:'작성자', field:'author_name', width:90 },
    { headerName:'', width:130, sortable:false,
      cellRenderer: function(p) {
        var wrap = document.createElement('div');
        wrap.style.display = 'flex'; wrap.style.gap = '4px';
        var edit = document.createElement('button');
        edit.className = 'tbl-btn'; edit.textContent = '수정';
        edit.onclick = function() { openEdit(p.data); };
        var del = document.createElement('button');
        del.className = 'tbl-btn'; del.style.color = '#ef4444'; del.textContent = '삭제';
        del.onclick = function() { deleteNotice(p.data.id); };
        wrap.appendChild(edit); wrap.appendChild(del);
        return wrap;
      }
    },
  ], [], { noRowsText: '등록된 공지사항이 없습니다.' });
}

async function loadList() {
  showGlobalLoading('공지사항을 불러오는 중...');
  var keyword = val('noticeKeyword');
  var field   = document.getElementById('noticeField')?.value || 'all';
  var from    = val('noticeFrom');
  var to      = val('noticeTo');

  var q = supabaseClient.from('system_notices').select('*')
    .order('is_pinned', { ascending:false })
    .order('created_at', { ascending:false });

  if (from) q = q.gte('created_at', from);
  if (to)   q = q.lte('created_at', to + 'T23:59:59');

  if (keyword) {
    if (field === 'title')        q = q.ilike('title', '%' + keyword + '%');
    else if (field === 'content') q = q.ilike('content', '%' + keyword + '%');
    else if (field === 'author')  q = q.ilike('author_name', '%' + keyword + '%');
    else                          q = q.or('title.ilike.%' + keyword + '%,content.ilike.%' + keyword + '%');
  }

  var { data, error } = await q;
  hideGlobalLoading();
  if (error) { alert('불러오기 실패: ' + error.message); return; }
  var label = document.getElementById('noticeCountLabel');
  if (label) label.textContent = '총 ' + (data?.length || 0) + '건';
  updateMgGrid(_grid, data || []);
}

function openAdd() {
  _editingId = null;
  setVal('nf_title', '');
  setVal('nf_content', '');
  setVal('nf_pinned', 'false');
  setVal('nf_active', 'true');
  document.getElementById('noticeModalTitle').textContent = '공지 작성';
  openModal('noticeModal');
}

function openEdit(row) {
  _editingId = row.id;
  setVal('nf_title', row.title);
  setVal('nf_content', row.content);
  setVal('nf_pinned', String(row.is_pinned));
  setVal('nf_active', String(row.is_active));
  document.getElementById('noticeModalTitle').textContent = '공지 수정';
  openModal('noticeModal');
}

async function saveNotice() {
  var title = val('nf_title');
  if (!title) { alert('제목을 입력해주세요.'); return; }
  var payload = {
    title: title,
    content: val('nf_content'),
    is_pinned: document.getElementById('nf_pinned').value === 'true',
    is_active: document.getElementById('nf_active').value === 'true',
    author_name: currentUser.user_name || currentUser.email,
    author_id: currentUser.id,
  };
  showGlobalLoading('저장 중...');
  var error;
  if (_editingId) {
    ({ error } = await supabaseClient.from('system_notices').update(payload).eq('id', _editingId));
  } else {
    ({ error } = await supabaseClient.from('system_notices').insert(payload));
  }
  hideGlobalLoading();
  if (error) { alert('저장 실패: ' + error.message); return; }
  closeModal('noticeModal');
  await loadList();
}

async function deleteNotice(id) {
  if (!confirm('이 공지사항을 삭제하시겠습니까?')) return;
  var { error } = await supabaseClient.from('system_notices').delete().eq('id', id);
  if (error) { alert('삭제 실패: ' + error.message); return; }
  await loadList();
}

async function init() {
  var session = await auth.requireAuth();
  if (!session) return;
  currentUser = await auth.getSession();

  initGrid();
  document.getElementById('noticeAddBtn')?.addEventListener('click', openAdd);
  document.getElementById('noticeSearchBtn')?.addEventListener('click', loadList);
  document.getElementById('noticeKeyword')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') loadList(); });
  document.getElementById('noticeSaveBtn')?.addEventListener('click', saveNotice);

  await loadList();
}

document.addEventListener('DOMContentLoaded', init);
