// ========================================================
// [길드톡 메신저] 메인 클라이언트 스크립트 (script.js)
// 카카오톡 인터페이스 / 실시간 채팅 스트림 / 계정 세션 / 모듈 로더
// ========================================================

var supabaseClient = null;
var cachedMemberList = [];
var myCurrentNick = localStorage.getItem("guild_my_nickname") || "";
var myCurrentPin = localStorage.getItem("guild_my_pin") || "";
var myCurrentAvatar = localStorage.getItem("guild_my_avatar") || "👤";
var myCurrentClass = localStorage.getItem("guild_my_class") || "미설정";
var deferredPrompt = null;
var kakaoToastTimer = null;
var pendingOptimisticMessages = [];
var lastRenderedSender = null;

// --------------------------------------------------------
// 1. 공통 토스트 및 시간 유틸리티
// --------------------------------------------------------
function showKakaoToast(msg, icon = "💬") {
  const box = document.getElementById("kakaoToastBox");
  const m = document.getElementById("kakaoToastMsg");
  const ic = document.getElementById("kakaoToastIcon");
  if (!box) return;

  m.innerText = msg;
  ic.innerText = icon;
  box.classList.add("show");

  if (kakaoToastTimer) clearTimeout(kakaoToastTimer);
  kakaoToastTimer = setTimeout(() => box.classList.remove("show"), 2300);
}

function formatTime24Hour(dateInput) {
  if (!dateInput) return "";
  let d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) d = new Date();

  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return formatter.format(d);
}

function formatTime24HourWithDate(dateInput) {
  if (!dateInput) return "";
  let d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) d = new Date();

  const timeStr = formatTime24Hour(d);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${timeStr} (${m}/${day})`;
}

function formatKSTChatTime(dateInput) {
  if (!dateInput) return "";
  let d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) d = new Date();

  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  return formatter.format(d);
}

function isSameMinuteKST(dateStr1, dateStr2) {
  if (!dateStr1 || !dateStr2) return false;
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return false;

  const f = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false
  });
  return f.format(d1) === f.format(d2);
}

function ensureSupabaseInitialized() {
  if (!supabaseClient && window.supabase && typeof SUPABASE_CONFIG !== 'undefined') {
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
    window.supabaseClient = supabaseClient;
  }
  return supabaseClient;
}

// --------------------------------------------------------
// 2. 길드 환경설정 및 세션 초기화
// --------------------------------------------------------
async function initGuildAppSession() {
  ensureSupabaseInitialized();

  await Promise.allSettled([
    loadGuildSettings(),
    window.loadGuildMembersData(),
    (typeof window.loadBossTimersList === 'function' ? window.loadBossTimersList() : Promise.resolve())
  ]);

  initThemeFromStorage();
  checkAuthAndOpenAppropriateModal();
}

function checkAuthAndOpenAppropriateModal() {
  myCurrentNick = localStorage.getItem("guild_my_nickname") || "";
  myCurrentPin = localStorage.getItem("guild_my_pin") || "";

  if (!myCurrentNick) {
    showGuildLoginModal();
    const chatContainer = document.getElementById("chatMessagesView");
    if (chatContainer) {
      chatContainer.innerHTML = `
        <div class="text-center my-4">
          <span class="badge bg-secondary bg-opacity-25 text-secondary px-3 py-2" style="font-size:0.75rem;">로그인이 필요합니다.</span>
        </div>
      `;
    }
  } else {
    updateProfileUI(myCurrentNick);
    loadPastChatMessages();
  }
}

async function loadGuildSettings() {
  try {
    // 1. 현재 활성 길드(my_joined_guilds) 정보 우선 반영
    const currentGid = localStorage.getItem("current_guild_id");
    let joined = [];
    try { joined = JSON.parse(localStorage.getItem("my_joined_guilds") || "[]"); } catch(e) {}
    const currentGuild = joined.find(g => g.guild_id === currentGid);

    if (currentGuild) {
      const gName = currentGuild.guild_name || "길드";
      const gGame = currentGuild.game_name || "게임";

      const badge = document.getElementById("mainTabGameBadge");
      if (badge) {
        badge.innerText = gGame;
        badge.style.display = "inline-block";
      }
      const t1 = document.getElementById("chatRoomTitle");
      const t2 = document.getElementById("menuGuildNameText");
      const t3 = document.getElementById("loginGuildTitle");
      const t4 = document.getElementById("mainTabHeaderSubtitle");
      if (t1) t1.innerText = gName + " 대화방";
      if (t2) t2.innerText = gName;
      if (t3) t3.innerText = "[" + gGame + "] " + gName + " 로그인";
      if (t4) t4.innerText = gGame + " · " + gName;
    }

    // 2. 서버 설정 조회 동기화
    const res = await apiRequest("guild_settings?select=key,value");
    if (res && res.length > 0) {
      res.forEach(item => {
        if (item.key === 'guild_name' && item.value && !currentGuild) {
          const t1 = document.getElementById("chatRoomTitle");
          const t2 = document.getElementById("menuGuildNameText");
          const t3 = document.getElementById("loginGuildTitle");
          const t4 = document.getElementById("mainTabHeaderSubtitle");
          if (t1) t1.innerText = item.value + " 대화방";
          if (t2) t2.innerText = item.value;
          if (t3) t3.innerText = item.value + " 메신저 로그인";
          if (t4) t4.innerText = item.value;
        }
      });
    }
  } catch (e) {}
}

window.loadGuildMembersData = async function() {
  try {
    const currentGid = localStorage.getItem("current_guild_id");
    let members = [];
    if (currentGid) {
      try {
        members = await apiRequest("guild_members?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*&order=name.asc");
      } catch (err) {}
    }
    if (!members || members.length === 0) {
      members = await apiRequest("guild_members?select=*&order=name.asc");
    }
    cachedMemberList = members || [];
    window.cachedMemberList = cachedMemberList;

    cachedMemberList.sort((a, b) => {
      const pA = getRolePriority(a.role);
      const pB = getRolePriority(b.role);
      if (pA !== pB) return pA - pB;
      const nA = a.name || a.nickname || "";
      const nB = b.name || b.nickname || "";
      return nA.localeCompare(nB, 'ko');
    });

    const countElem = document.getElementById("roomMemberCountText");
    if (countElem) countElem.innerText = cachedMemberList.length;

    renderLoginMemberDropdown("");
  } catch (e) {}
};

function getRolePriority(role) {
  const r = String(role || '').trim();
  if (r === '길드장' || r === '길마') return 1;
  if (r === '부길드장' || r === '부길마') return 2;
  if (r === '정예') return 3;
  return 4;
}

// --------------------------------------------------------
// 3. 서랍(드로어) 및 프로필 편집 모달 제어
// --------------------------------------------------------
function toggleMenuDrawer(isOpen) {
  const drawer = document.getElementById("menuSidebarDrawer");
  const backdrop = document.getElementById("commonDrawerBackdrop");
  if (!drawer || !backdrop) return;

  if (isOpen) {
    drawer.classList.add("open");
    backdrop.classList.add("show");
  } else {
    drawer.classList.remove("open");
    backdrop.classList.remove("show");
  }
}

function toggleMembersDrawer(isOpen) {
  const drawer = document.getElementById("membersSidebarDrawer");
  const backdrop = document.getElementById("commonDrawerBackdrop");
  if (!drawer || !backdrop) return;

  if (isOpen) {
    drawer.classList.add("open");
    backdrop.classList.add("show");
    renderMembersDrawerList();
  } else {
    drawer.classList.remove("open");
    backdrop.classList.remove("show");
  }
}

function toggleBossDrawer(isOpen) {
  const drawer = document.getElementById("bossTimerSidebarDrawer");
  const backdrop = document.getElementById("commonDrawerBackdrop");
  if (!drawer || !backdrop) return;

  if (isOpen) {
    drawer.classList.add("open");
    backdrop.classList.add("show");
    if (typeof window.loadBossTimersList === 'function') {
      window.loadBossTimersList();
    }
  } else {
    drawer.classList.remove("open");
    backdrop.classList.remove("show");
  }
}

function closeAllDrawers() {
  toggleMenuDrawer(false);
  toggleMembersDrawer(false);
  toggleBossDrawer(false);
}

function renderMembersDrawerList() {
  const box = document.getElementById("drawerMemberListContainer");
  const countVal = document.getElementById("drawerMemberCountVal");
  if (!box) return;

  if (countVal) countVal.innerText = cachedMemberList.length;

  if (!cachedMemberList || cachedMemberList.length === 0) {
    box.innerHTML = `<div class="text-center py-4 text-secondary small">등록된 길드원이 없습니다.</div>`;
    return;
  }

  box.innerHTML = cachedMemberList.map(m => {
    const name = m.name || m.nickname || "무명";
    const role = m.role || "일반";
    const job = m.class_name || m.job_class || "미설정";
    const isMaster = (role === "길드장" || role === "길마");
    const isSubMaster = (role === "부길드장" || role === "부길마");
    const isElite = (role === "정예");

    let badgeClass = "badge bg-secondary bg-opacity-25 text-secondary";
    if (isMaster) badgeClass = "badge bg-warning text-dark fw-bold";
    else if (isSubMaster) badgeClass = "badge bg-info text-dark fw-bold";
    else if (isElite) badgeClass = "badge bg-primary text-white fw-bold";

    return `
      <div class="chat-room-card friend-item-card" style="margin-bottom:6px; padding:7px 10px;">
        <div class="user-avatar" style="width:30px; height:30px; font-size:0.9rem;">
          ${isMaster ? '👑' : '👤'}
        </div>
        <div class="room-content-box">
          <div class="d-flex align-items-center justify-content-between">
            <span class="room-name-text member-name-line" style="font-size:0.82rem;">${name}</span>
            <span class="${badgeClass}" style="font-size:0.62rem; padding:2px 5px;">${role}</span>
          </div>
          <div class="room-msg-preview member-class-desc" style="font-size:0.68rem; color:#64748b;">
            ${job}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function updateProfileUI(nick) {
  myCurrentNick = nick || "";
  myCurrentAvatar = localStorage.getItem("guild_my_avatar") || "👤";
  myCurrentClass = localStorage.getItem("guild_my_class") || "직업 미설정";

  const dAvatar = document.getElementById("drawerMyAvatarIcon");
  const dNick = document.getElementById("drawerMyNickText");
  const dClass = document.getElementById("drawerMyClassText");
  if (dAvatar) dAvatar.innerText = myCurrentAvatar;
  if (dNick) dNick.innerText = myCurrentNick || "로그인 필요";
  if (dClass) dClass.innerText = myCurrentClass;

  const tAvatar = document.getElementById("mainTabMyAvatar");
  const tNick = document.getElementById("mainTabMyNick");
  const tClass = document.getElementById("mainTabMyClass");
  if (tAvatar) tAvatar.innerText = myCurrentAvatar;
  if (tNick) tNick.innerText = myCurrentNick || "로그인 필요";
  if (tClass) tClass.innerText = myCurrentClass;
}

function openProfileEditModal() {
  const modal = document.getElementById("modalProfileEdit");
  if (modal) modal.style.display = "flex";
}
function closeProfileEditModal() {
  const modal = document.getElementById("modalProfileEdit");
  if (modal) modal.style.display = "none";
}

async function selectClassProfile(icon, className) {
  myCurrentAvatar = icon;
  myCurrentClass = className;
  localStorage.setItem("guild_my_avatar", icon);
  localStorage.setItem("guild_my_class", className);

  updateProfileUI(myCurrentNick);
  closeProfileEditModal();
  showKakaoToast(`직업이 [${className}] (으)로 변경되었습니다.`, icon);

  if (myCurrentNick) {
    try {
      await apiRequest(`guild_members?name=eq.${encodeURIComponent(myCurrentNick)}`, "PATCH", {
        class_name: className
      });
    } catch (e) {}
  }
}

// --------------------------------------------------------
// 4. 길드 로그인 / 로그아웃 및 다중 길드 스위칭
// --------------------------------------------------------
function renderLoginMemberDropdown(query = "") {
  const selectElem = document.getElementById("loginMemberSelect");
  if (!selectElem) return;

  const q = (query || "").toLowerCase().trim();
  const filtered = cachedMemberList.filter(m => {
    const name = m.name || m.nickname || "";
    return name.toLowerCase().includes(q);
  });

  selectElem.innerHTML = `<option value="">닉네임을 선택하세요 (${filtered.length}명)</option>` +
    filtered.map(m => {
      const name = m.name || m.nickname || "";
      const role = m.role || "일반";
      const cls = m.class_name || m.job_class || "";
      return `<option value="${name}">${name} (${role}${cls ? ' · ' + cls : ''})</option>`;
    }).join("");
}

function onLoginSearchInput(val) {
  renderLoginMemberDropdown(val);
}
function onLoginSelectChange(val) {
  const searchInput = document.getElementById("loginNickSearchInput");
  if (searchInput && val) searchInput.value = val;
  const pinInput = document.getElementById("loginPinInput");
  if (pinInput) pinInput.focus();
}

function showGuildLoginModal() {
  const modal = document.getElementById("guildLoginModal");
  if (modal) modal.style.display = "flex";

  const searchInput = document.getElementById("loginNickSearchInput");
  const pinInput = document.getElementById("loginPinInput");
  if (searchInput) {
    searchInput.value = myCurrentNick || "";
    renderLoginMemberDropdown(searchInput.value);
  }
  if (pinInput) pinInput.value = "";
}

async function executeGuildLogin() {
  const searchInput = document.getElementById("loginNickSearchInput");
  const selectElem = document.getElementById("loginMemberSelect");
  const selectedName = (searchInput && searchInput.value.trim()) || (selectElem && selectElem.value.trim()) || "";
  const inputPin = document.getElementById("loginPinInput").value.trim();

  if (!selectedName) return showKakaoToast("본인 닉네임을 입력하거나 선택해주세요!", "⚠️");
  if (!inputPin) return showKakaoToast("비밀번호(PIN)를 입력해주세요!", "⚠️");

  const isSuperId = (selectedName.toLowerCase() === "admin" || selectedName === "슈퍼관리자");
  if (isSuperId && (inputPin === "123456" || inputPin === "master7777")) {
    myCurrentNick = "슈퍼관리자";
    myCurrentPin = inputPin;
    localStorage.setItem("guild_my_nickname", "슈퍼관리자");
    localStorage.setItem("guild_my_pin", inputPin);
    localStorage.setItem("guild_my_role", "슈퍼관리자");
    sessionStorage.setItem("admin_auth", "true");
    sessionStorage.setItem("admin_role", "super");

    myCurrentClass = "👑 슈퍼관리자";
    myCurrentAvatar = "👑";
    localStorage.setItem("guild_my_class", myCurrentClass);
    localStorage.setItem("guild_my_avatar", myCurrentAvatar);

    updateProfileUI("슈퍼관리자");
    document.getElementById("guildLoginModal").style.display = "none";
    resetAndReloadChatAfterAuth();
    return showKakaoToast("👑 슈퍼관리자(Master)로 로그인되었습니다.", "🎉");
  }

  const targetMember = cachedMemberList.find(m => {
    const n = m.name || m.nickname || "";
    return n.toLowerCase() === selectedName.toLowerCase();
  });

  if (!targetMember) {
    return showKakaoToast("등록된 길드원을 찾을 수 없습니다. 닉네임을 확인하세요.", "⚠️");
  }

  let expectedPin = "0000";
  if (targetMember.pin) {
    expectedPin = String(targetMember.pin).trim();
  } else {
    try {
      const res = await apiRequest(`guild_members?name=eq.${encodeURIComponent(targetMember.name)}&select=pin,role`);
      if (res && res.length > 0 && res[0].pin) expectedPin = String(res[0].pin).trim();
    } catch (e) {}
  }

  if (inputPin !== expectedPin) {
    document.getElementById("loginPinInput").value = "";
    document.getElementById("loginPinInput").focus();
    return showKakaoToast("비밀번호가 올바르지 않습니다! (초기값: 0000)", "❌");
  }

  const memberName = targetMember.name || targetMember.nickname;
  myCurrentNick = memberName;
  myCurrentPin = inputPin;
  localStorage.setItem("guild_my_nickname", memberName);
  localStorage.setItem("guild_my_pin", inputPin);

  const userRole = targetMember.role || "일반";
  localStorage.setItem("guild_my_role", userRole);

  if (userRole === "길드장" || userRole === "길마" || userRole === "부길드장" || userRole === "부길마") {
    sessionStorage.setItem("admin_auth", "true");
    sessionStorage.setItem("admin_role", "admin");
  } else if (userRole === "정예") {
    sessionStorage.setItem("admin_auth", "true");
    sessionStorage.setItem("admin_role", "elite");
  } else {
    sessionStorage.removeItem("admin_auth");
    sessionStorage.removeItem("admin_role");
  }

  // 현재 활성 길드 정보 업데이트
  const currentGid = localStorage.getItem("current_guild_id");
  if (currentGid) {
    let joined = [];
    try { joined = JSON.parse(localStorage.getItem("my_joined_guilds") || "[]"); } catch(e) {}
    const existing = joined.find(g => g.guild_id === currentGid);
    if (existing) {
      existing.nickname = memberName;
      existing.role = userRole;
      localStorage.setItem("my_joined_guilds", JSON.stringify(joined));
    }
  }

  updateProfileUI(memberName);
  document.getElementById("guildLoginModal").style.display = "none";
  showKakaoToast(`[${memberName}] 님 반갑습니다!`, "🎉");

  resetAndReloadChatAfterAuth();
}

// [개선]: 카카오톡 커스텀 로그아웃 확인 모달 연동
function handleUserLogout() {
  if (typeof openConfirmLogoutModal === "function") {
    openConfirmLogoutModal();
    return;
  }
  executeLogoutProcess();
}

window.executeLogoutProcess = function() {
  localStorage.removeItem("guild_my_nickname");
  localStorage.removeItem("guild_my_pin");
  localStorage.removeItem("guild_my_role");
  sessionStorage.removeItem("admin_auth");
  sessionStorage.removeItem("admin_role");
  myCurrentNick = "";
  myCurrentPin = "";

  const chatContainer = document.getElementById("chatMessagesView");
  if (chatContainer) {
    chatContainer.innerHTML = `
      <div class="text-center my-1">
        <span class="badge bg-secondary bg-opacity-25 text-secondary px-2 py-1" style="font-size:0.65rem;">로그인이 필요합니다.</span>
      </div>
    `;
  }
  lastRenderedSender = null;

  toggleMenuDrawer(false);
  showGuildLoginModal();
};

window.switchActiveGuild = function(guildId) {
  let joined = [];
  try { joined = JSON.parse(localStorage.getItem("my_joined_guilds") || "[]"); } catch(e) {}
  const target = joined.find(g => g.guild_id === guildId);
  if (!target) return;

  localStorage.setItem("current_guild_id", target.guild_id);
  localStorage.setItem("guild_my_nickname", target.nickname || "");
  localStorage.setItem("guild_my_role", target.role || "일반");
  location.reload();
};

function resetAndReloadChatAfterAuth() {
  const chatContainer = document.getElementById("chatMessagesView");
  if (chatContainer) {
    chatContainer.innerHTML = `
      <div class="text-center my-1">
        <span class="badge bg-secondary bg-opacity-25 text-secondary px-2 py-1" style="font-size:0.65rem;">대화가 안전하게 연결되었습니다.</span>
      </div>
    `;
  }
  lastRenderedSender = null;
  loadPastChatMessages();
}

// --------------------------------------------------------
// 5. 과거 메시지 로드 및 대화방 렌더링
// --------------------------------------------------------
async function loadPastChatMessages() {
  const chatContainer = document.getElementById("chatMessagesView");
  if (!chatContainer) return;

  try {
    const activeRoomId = window.currentActiveRoomId || "public";
    let query = `chat_messages?order=created_at.asc&limit=70`;
    if (activeRoomId && activeRoomId !== "public") {
      query = `chat_messages?room_id=eq.${encodeURIComponent(activeRoomId)}&order=created_at.asc&limit=70`;
    }

    const messages = await apiRequest(query);

    chatContainer.innerHTML = "";
    lastRenderedSender = null;

    if (!messages || messages.length === 0) {
      chatContainer.innerHTML = `
        <div class="text-center my-4 text-secondary small">
          <span class="badge bg-secondary bg-opacity-10 text-secondary px-3 py-2" style="font-size:0.75rem;">대화 내역이 없습니다. 첫 인사를 건네보세요!</span>
        </div>
      `;
      return;
    }

    messages.forEach((msg, idx) => {
      const prevMsg = idx > 0 ? messages[idx - 1] : null;
      const nextMsg = idx < messages.length - 1 ? messages[idx + 1] : null;
      renderSingleChatMessageBubble(msg, prevMsg, nextMsg);
    });

    scrollChatToBottom();
  } catch (err) {
    console.error("loadPastChatMessages error:", err);
  }
}

function scrollChatToBottom() {
  const container = document.getElementById("chatMessagesView");
  if (container) {
    setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 50);
  }
}

function renderSingleChatMessageBubble(msg, prevMsg = null, nextMsg = null) {
  const container = document.getElementById("chatMessagesView");
  if (!container) return;

  const isMe = (myCurrentNick && msg.sender_name === myCurrentNick);
  const timeFormatted = formatKSTChatTime(msg.created_at);

  const isConsecutivePrev = prevMsg && (prevMsg.sender_name === msg.sender_name) && isSameMinuteKST(prevMsg.created_at, msg.created_at);
  const isConsecutiveNext = nextMsg && (nextMsg.sender_name === msg.sender_name) && isSameMinuteKST(msg.created_at, nextMsg.created_at);

  const hideAvatarAndName = isConsecutivePrev;
  const hideTimestamp = isConsecutiveNext;

  const totalMembers = (cachedMemberList && cachedMemberList.length > 0) ? cachedMemberList.length : 10;
  const readCount = Number(msg.read_count || 1);
  const unreadCount = Math.max(0, totalMembers - readCount);
  const unreadSpanHtml = (unreadCount > 0)
    ? `<span class="chat-unread-count" id="unread-count-${msg.id || ''}">${unreadCount}</span>`
    : `<span class="chat-unread-count" id="unread-count-${msg.id || ''}" style="display:none;"></span>`;

  const metaHtml = `
    <div class="chat-meta-box">
      ${unreadSpanHtml}
      ${!hideTimestamp ? `<span class="chat-timestamp">${timeFormatted}</span>` : ''}
    </div>
  `;

  let bubbleBodyHtml = "";
  let isSpecialCard = false;

  if (msg.message_type === "boss_briefing" || msg.content?.startsWith("[보스현황브리핑]")) {
    isSpecialCard = true;
    bubbleBodyHtml = msg.content;
  } else if (msg.message_type === "boss_spawn" || msg.content?.includes("boss-alert-mini-card")) {
    isSpecialCard = true;
    bubbleBodyHtml = msg.content;
  } else if (msg.message_type === "raid_report" || msg.content?.includes("raid-report-card")) {
    isSpecialCard = true;
    bubbleBodyHtml = msg.content;
  } else if (msg.message_type === "finance_report" || msg.content?.includes("finance-report-card")) {
    isSpecialCard = true;
    bubbleBodyHtml = msg.content;
  } else if (msg.message_type === "records_report" || msg.content?.includes("records-report-card")) {
    isSpecialCard = true;
    bubbleBodyHtml = msg.content;
  } else if (msg.message_type === "image") {
    bubbleBodyHtml = `<img src="${msg.content}" style="max-width:240px; border-radius:8px; cursor:pointer;" onclick="openImagePreviewModal('${msg.content}')" alt="공유 사진">`;
  } else {
    const escaped = escapeHtmlEntities(msg.content || "");
    bubbleBodyHtml = `<div class="chat-bubble">${escaped}</div>`;
  }

  const row = document.createElement("div");
  row.className = `chat-item-row ${isMe ? 'me' : 'other'} ${isConsecutivePrev ? 'consecutive' : ''}`;
  if (msg.id) row.id = `chat-msg-row-${msg.id}`;

  if (isMe) {
    row.innerHTML = `
      <div class="chat-bubble-flex">
        ${metaHtml}
        <div class="chat-msg-body ${isSpecialCard ? 'raid-msg-body' : ''}">
          ${bubbleBodyHtml}
        </div>
      </div>
    `;
  } else {
    const matchedSender = cachedMemberList.find(m => (m.name === msg.sender_name || m.nickname === msg.sender_name));
    const senderRole = matchedSender?.role || "";
    const senderClass = matchedSender?.class_name || matchedSender?.job_class || "";
    const isBot = (msg.sender_name === "시스템" || msg.sender_name === "보스타이머");

    let avatarIcon = isBot ? "🤖" : (senderRole.includes("길드장") ? "👑" : "👤");

    row.innerHTML = `
      ${!hideAvatarAndName ? `
        <div class="chat-sender-avatar ${isBot ? 'bot' : ''}">
          ${avatarIcon}
        </div>
      ` : `
        <div style="width:34px; flex-shrink:0;"></div>
      `}
      <div class="chat-msg-body ${isSpecialCard ? 'raid-msg-body' : ''}">
        ${!hideAvatarAndName ? `
          <div class="chat-sender-name">
            ${escapeHtmlEntities(msg.sender_name)}${senderClass ? `<span style="font-size:10px; color:#64748b; font-weight:normal; margin-left:3px;">${senderClass}</span>` : ''}
          </div>
        ` : ''}
        <div class="chat-bubble-flex">
          ${bubbleBodyHtml}
          ${metaHtml}
        </div>
      </div>
    `;
  }

  container.appendChild(row);
  lastRenderedSender = msg.sender_name;
}

function escapeHtmlEntities(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --------------------------------------------------------
// 6. 메시지 전송 및 낙관적 UI 업데이트
// --------------------------------------------------------
async function sendMessageAction() {
  const textarea = document.getElementById("chatInputTextarea");
  if (!textarea) return;

  const content = textarea.value.trim();
  if (!content) return;

  if (!myCurrentNick) {
    showGuildLoginModal();
    return showKakaoToast("로그인 후 메시지를 전송할 수 있습니다.", "⚠️");
  }

  // 1. 보스 컷/예약 명령어 가로채기
  if (content.startsWith("!컷") || content.startsWith("!예약") || content.startsWith("!보스")) {
    if (typeof window.handleBossCommandInChat === 'function') {
      const handled = await window.handleBossCommandInChat(content);
      if (handled) {
        textarea.value = "";
        return;
      }
    }
  }

  textarea.value = "";
  textarea.style.height = "38px";

  const tempId = "temp-" + Date.now();
  const activeRoomId = window.currentActiveRoomId || "public";
  const optimisticMsg = {
    id: tempId,
    room_id: activeRoomId,
    sender_name: myCurrentNick,
    content: content,
    message_type: "text",
    created_at: new Date().toISOString(),
    read_count: 1
  };

  renderSingleChatMessageBubble(optimisticMsg);
  scrollChatToBottom();

  try {
    const payload = {
      room_id: activeRoomId,
      sender_name: myCurrentNick,
      content: content,
      message_type: "text"
    };

    const res = await apiRequest("chat_messages", "POST", [payload]);
    if (res && res.length > 0 && res[0].id) {
      const tempElem = document.getElementById(`chat-msg-row-${tempId}`);
      if (tempElem) {
        tempElem.id = `chat-msg-row-${res[0].id}`;
      }
    }
  } catch (err) {
    console.error("메시지 전송 실패:", err);
    showKakaoToast("메시지 전송 실패 (재시도 중...)", "❌");
  }
}

// --------------------------------------------------------
// 7. 실시간 채팅 수신 (Realtime Subscription)
// --------------------------------------------------------
function initChatRealtimeStream() {
  const client = ensureSupabaseInitialized();
  if (!client) return;

  try {
    client
      .channel('public:chat_messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
        handleIncomingRealtimeMessage(payload.new);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, payload => {
        handleMessageReadCountUpdate(payload.new);
      })
      .subscribe();
  } catch (e) {
    console.error("Realtime subscription error:", e);
  }
}

function handleIncomingRealtimeMessage(newMsg) {
  if (!newMsg) return;

  const activeRoomId = window.currentActiveRoomId || "public";
  if (newMsg.room_id && newMsg.room_id !== activeRoomId) {
    return;
  }

  if (newMsg.sender_name === myCurrentNick) {
    const existingTemp = document.getElementById(`chat-msg-row-${newMsg.id}`);
    if (existingTemp) return;
  }

  renderSingleChatMessageBubble(newMsg);
  scrollChatToBottom();
}

function handleMessageReadCountUpdate(updatedMsg) {
  if (!updatedMsg || !updatedMsg.id) return;
  const unreadSpan = document.getElementById(`unread-count-${updatedMsg.id}`);
  if (!unreadSpan) return;

  const totalMembers = (cachedMemberList && cachedMemberList.length > 0) ? cachedMemberList.length : 10;
  const readCount = Number(updatedMsg.read_count || 1);
  const unread = Math.max(0, totalMembers - readCount);

  if (unread > 0) {
    unreadSpan.innerText = unread;
    unreadSpan.style.display = "inline";
  } else {
    unreadSpan.style.display = "none";
  }
}

// --------------------------------------------------------
// 8. 대화 검색 바 토글 및 인라인 검색 기능
// --------------------------------------------------------
function toggleChatSearchBar() {
  const bar = document.getElementById("chatSearchBarWrap");
  if (!bar) return;

  if (bar.style.display === "none" || !bar.style.display) {
    bar.style.display = "block";
    const input = document.getElementById("chatSearchKeywordInput");
    if (input) {
      input.value = "";
      input.focus();
    }
  } else {
    bar.style.display = "none";
    clearChatSearchHighlights();
  }
}

function clearChatSearchInput() {
  const input = document.getElementById("chatSearchKeywordInput");
  if (input) {
    input.value = "";
    input.focus();
  }
  clearChatSearchHighlights();
}

function clearChatSearchHighlights() {
  const countText = document.getElementById("searchMatchCountText");
  if (countText) countText.innerText = "";

  const container = document.getElementById("chatMessagesView");
  if (!container) return;
  const rows = container.querySelectorAll(".chat-item-row");
  rows.forEach(r => r.style.opacity = "1");
}

// --------------------------------------------------------
// 9. 멘션(@) 및 파일 첨부
// --------------------------------------------------------
function insertEmojiToInput(emoji) {
  const textarea = document.getElementById("chatInputTextarea");
  if (!textarea) return;
  textarea.value += emoji;
  textarea.focus();
}

function triggerFileUploadAction() {
  const fileInput = document.getElementById("kakaoHiddenFileInput");
  if (fileInput) fileInput.click();
}

async function handleKakaoFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  showKakaoToast("사진을 업로드 중입니다...", "⏳");

  try {
    const reader = new FileReader();
    reader.onload = async function(event) {
      const base64Data = event.target.result;
      const activeRoomId = window.currentActiveRoomId || "public";
      await apiRequest("chat_messages", "POST", [{
        room_id: activeRoomId,
        sender_name: myCurrentNick,
        content: base64Data,
        message_type: "image"
      }]);
      showKakaoToast("사진이 전송되었습니다!", "📸");
    };
    reader.readAsDataURL(file);
  } catch (err) {
    showKakaoToast("사진 전송 실패", "❌");
  } finally {
    e.target.value = "";
  }
}

// --------------------------------------------------------
// 10. 모듈 페이지 오버레이 열기 및 닫기
// --------------------------------------------------------
async function openModulePage(pageName) {
  const overlay = document.getElementById("moduleOverlay");
  const bodyBox = document.getElementById("overlayBodyContent");
  const titleText = document.getElementById("overlayNavTitle");
  if (!overlay || !bodyBox) return;

  toggleMenuDrawer(false);

  const titleMap = {
    'PageNotice': '공지사항',
    'PageRegister': '보스등록',
    'PageRecords': '보스참여자목록',
    'PageWish': '분배희망신청',
    'PageSettle': '정산내역',
    'PageMembers': '길드원목록',
    'PageSettings': '환경설정'
  };
  if (titleText) titleText.innerText = titleMap[pageName] || "기능 화면";

  bodyBox.innerHTML = `
    <div class="text-center py-5 text-secondary">
      <i class="fa-solid fa-spinner fa-spin fa-2x mb-3"></i>
      <div>화면을 불러오는 중...</div>
    </div>
  `;
  overlay.style.display = "flex";

  try {
    const res = await fetch(`pages/${pageName}.html`);
    if (!res.ok) throw new Error("페이지 로드 실패");
    const htmlText = await res.text();
    bodyBox.innerHTML = htmlText;

    const scripts = bodyBox.querySelectorAll("script");
    scripts.forEach(oldScript => {
      const newScript = document.createElement("script");
      Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
      newScript.appendChild(document.createTextNode(oldScript.innerHTML));
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  } catch (err) {
    bodyBox.innerHTML = `
      <div class="text-center py-5 text-danger">
        <i class="fa-solid fa-triangle-exclamation fa-2x mb-3"></i>
        <div>화면을 불러오지 못했습니다.</div>
      </div>
    `;
  }
}

function closeModuleOverlay() {
  const overlay = document.getElementById("moduleOverlay");
  const bodyBox = document.getElementById("overlayBodyContent");
  if (overlay) overlay.style.display = "none";
  if (bodyBox) bodyBox.innerHTML = "";
}

function initThemeFromStorage() {
  const saved = localStorage.getItem("guild_theme_mode") || "dark";
  if (saved === "light") {
    document.documentElement.classList.add("theme-light");
    document.documentElement.classList.remove("theme-dark");
    document.body.classList.add("theme-light");
    document.body.classList.remove("theme-dark");
  } else {
    document.documentElement.classList.add("theme-dark");
    document.documentElement.classList.remove("theme-light");
    document.body.classList.add("theme-dark");
    document.body.classList.remove("theme-light");
  }
}

// --------------------------------------------------------
// 초기 실행 이벤트
// --------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  initGuildAppSession();
  initChatRealtimeStream();

  const textarea = document.getElementById("chatInputTextarea");
  if (textarea) {
    textarea.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessageAction();
      }
    });
  }
});
