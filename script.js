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
window.currentActiveRoomId = "default_public";

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
  let d;
  if (typeof dateInput === 'string') {
    let clean = dateInput.trim();
    if (clean.includes(' ') && !clean.includes('T')) clean = clean.replace(' ', 'T');
    if (!clean.endsWith('Z') && !clean.includes('+') && !clean.includes('-')) clean += 'Z';
    d = new Date(clean);
  } else {
    d = new Date(dateInput);
  }
  if (isNaN(d.getTime())) d = new Date();

  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  return formatter.format(d);
}

window.formatTime24Hour = formatTime24Hour;
window.formatTime24HourWithDate = formatTime24HourWithDate;
window.formatKSTChatTime = formatKSTChatTime;

// --------------------------------------------------------
// 2. 테마 설정 및 초기화
// --------------------------------------------------------
window.applyAppTheme = function(mode) {
  const theme = mode || localStorage.getItem("guild_theme_mode") || "dark";
  const isLight = (theme === "light");
  if (isLight) {
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
  localStorage.setItem("guild_theme_mode", theme);
};

window.addEventListener("storage", function(e) {
  if (e.key === "guild_theme_mode") window.applyAppTheme(e.newValue);
});

async function initApp() {
  if (typeof window.applyAppTheme === 'function') window.applyAppTheme();
  if (window.supabase && typeof SUPABASE_CONFIG !== 'undefined') {
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
    window.supabaseClient = supabaseClient;
  }

  myCurrentNick = localStorage.getItem("guild_my_nickname") || "";
  myCurrentPin = localStorage.getItem("guild_my_pin") || "";
  myCurrentClass = localStorage.getItem("guild_my_class") || "직업 미지정";
  myCurrentAvatar = localStorage.getItem("guild_my_avatar") || "👤";
  window.currentActiveRoomId = "default_public";

  await loadGuildSettings();
  await window.loadGuildMembersData();

  if (typeof window.loadBossTimersList === 'function') await window.loadBossTimersList();
  if (typeof window.startLocalBossWatchTimer === 'function') window.startLocalBossWatchTimer();

  listenRealtimeChatMessages();
  if (typeof window.listenRealtimeBossTimers === 'function') window.listenRealtimeBossTimers();

  setupPwaInstallation();
  bindMentionInputEvents();
  cleanupOldChatsBackground();

  if (!myCurrentNick) {
    if (typeof openWelcomeGatewayModal === 'function') {
      openWelcomeGatewayModal();
    } else {
      showGuildLoginModal();
    }
  } else {
    updateProfileUI(myCurrentNick);
    loadPastChatMessages();
  }
}

async function loadGuildSettings() {
  try {
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

    const res = await apiRequest("guild_settings?select=key,value");
    if (res && res.length > 0) {
      res.forEach(item => {
        if (item.key === 'guild_name' && item.value && !currentGuild) {
          const t1 = document.getElementById("chatRoomTitle");
          const t2 = document.getElementById("menuGuildNameText");
          const t3 = document.getElementById("loginGuildTitle");
          const t4 = document.getElementById("mainTabHeaderSubtitle");
          if (t1) t1.innerText = "전체 대화방";
          if (t2) t2.innerText = "길드 메신저";
          if (t3) t3.innerText = "길드 메신저 로그인";
          if (t4) t4.innerText = "길드 메신저";
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
  if (isOpen) {
    toggleMembersDrawer(false);
    toggleBossDrawer(false);
    if (drawer) drawer.classList.add("open");
    if (backdrop) backdrop.classList.add("show");
  } else {
    if (drawer) drawer.classList.remove("open");
    if (typeof window.closeModuleOverlay === "function") window.closeModuleOverlay();
    checkBackdropState();
  }
}

async function toggleMembersDrawer(isOpen) {
  const drawer = document.getElementById("membersSidebarDrawer");
  const backdrop = document.getElementById("commonDrawerBackdrop");
  if (isOpen) {
    toggleMenuDrawer(false);
    toggleBossDrawer(false);
    if (typeof window.closeModuleOverlay === "function") window.closeModuleOverlay();
    if (backdrop) backdrop.classList.add("show");
    if (drawer) drawer.classList.add("open");

    const container = document.getElementById("drawerMembersContainer");
    if (container) {
      container.innerHTML = `<div class="text-secondary small text-center py-5"><i class="fa-solid fa-spinner fa-spin me-2"></i>길드원을 불러오는 중...</div>`;
      try {
        const res = await fetch(`pages/PageMembers.html?_t=${Date.now()}`);
        if (!res.ok) throw new Error("로드 실패");
        const html = await res.text();
        container.innerHTML = html;

        document.querySelectorAll(".drawer-member-script").forEach(s => s.remove());
        container.querySelectorAll("script").forEach(s => {
          const sc = document.createElement("script");
          sc.className = "drawer-member-script";
          if (s.src) sc.src = s.src; else sc.textContent = s.textContent;
          document.body.appendChild(sc);
        });
      } catch (e) {
        container.innerHTML = `<div class="text-danger small text-center py-5">로드 실패: ${e.message}</div>`;
      }
    }
  } else {
    if (drawer) drawer.classList.remove("open");
    if (typeof window.closeModuleOverlay === "function") window.closeModuleOverlay();
    checkBackdropState();
  }
}

async function toggleBossDrawer(isOpen) {
  const drawer = document.getElementById("bossTimerSidebarDrawer");
  const backdrop = document.getElementById("commonDrawerBackdrop");
  if (isOpen) {
    toggleMenuDrawer(false);
    toggleMembersDrawer(false);
    if (backdrop) backdrop.classList.add("show");
    if (drawer) drawer.classList.add("open");
    await loadDrawerPageTimer();
  } else {
    if (drawer) drawer.classList.remove("open");
    checkBackdropState();
    if (typeof window.__currentModuleCleanup === "function") {
      window.__currentModuleCleanup();
    }
  }
}

async function loadDrawerPageTimer() {
  const area = document.getElementById("drawerBossListArea");
  if (!area) return;
  area.innerHTML = `<div class="text-secondary small text-center py-4"><i class="fa-solid fa-spinner fa-spin me-2"></i>불러오는 중...</div>`;
  try {
    const res = await fetch(`pages/PageTimer.html?_t=${Date.now()}`);
    if (!res.ok) throw new Error("로드 실패");
    const html = await res.text();
    area.innerHTML = html;

    document.querySelectorAll(".drawer-dynamic-script").forEach(s => s.remove());
    area.querySelectorAll("script").forEach(s => {
      const sc = document.createElement("script");
      sc.className = "drawer-dynamic-script";
      if (s.src) sc.src = s.src; else sc.textContent = s.textContent;
      document.body.appendChild(sc);
    });
  } catch (e) {
    area.innerHTML = `<div class="text-danger small text-center py-4">로드 실패: ${e.message}</div>`;
  }
}

window.handleBossDrawerRefresh = async function() {
  const btn = document.getElementById("btnRefreshBossDrawer");
  if (btn) btn.classList.add("rotating");

  if (typeof window.loadBossTimersList === "function") await window.loadBossTimersList();
  await loadDrawerPageTimer();

  setTimeout(() => {
    if (btn) btn.classList.remove("rotating");
    showKakaoToast("보스타임 현황이 갱신되었습니다.", "⏰");
  }, 400);
};

function closeAllDrawers() {
  toggleMenuDrawer(false);
  toggleMembersDrawer(false);
  toggleBossDrawer(false);
}

function checkBackdropState() {
  const d1 = document.getElementById("menuSidebarDrawer");
  const d2 = document.getElementById("membersSidebarDrawer");
  const d3 = document.getElementById("bossTimerSidebarDrawer");
  const backdrop = document.getElementById("commonDrawerBackdrop");
  const isOpen = (d1 && d1.classList.contains("open")) ||
                 (d2 && d2.classList.contains("open")) ||
                 (d3 && d3.classList.contains("open"));
  if (!isOpen && backdrop) backdrop.classList.remove("show");
}

function openProfileEditModal() {
  document.getElementById("modalProfileEdit").style.display = "flex";
}
function closeProfileEditModal() {
  document.getElementById("modalProfileEdit").style.display = "none";
}

async function selectClassProfile(icon, className) {
  myCurrentAvatar = icon;
  myCurrentClass = `${icon} ${className}`;
  
  localStorage.setItem("guild_my_avatar", icon);
  localStorage.setItem("guild_my_class", myCurrentClass);

  const aIcon = document.getElementById("sidebarAvatarIcon");
  const uClass = document.getElementById("sidebarUserClassText");
  if (aIcon) aIcon.innerText = icon;
  if (uClass) uClass.innerText = myCurrentClass;

  if (myCurrentNick) {
    try {
      await apiRequest(`guild_members?name=eq.${encodeURIComponent(myCurrentNick)}`, "PATCH", {
        job_class: myCurrentClass
      });
    } catch (e) {}
  }
  closeProfileEditModal();
  showKakaoToast(`직업이 [${className}] (으)로 변경되었습니다.`, icon);
}

// --------------------------------------------------------
// 4. 길드 로그인 / 로그아웃
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

  let expectedPin = "000000";
  if (targetMember.pin) {
    expectedPin = String(targetMember.pin).trim();
  } else {
    try {
      const qNick = targetMember.name || targetMember.nickname || "";
      let res = await apiRequest(`guild_members?nickname=eq.${encodeURIComponent(qNick)}&select=pin,role`);
      if (!res || res.length === 0) {
        res = await apiRequest(`guild_members?name=eq.${encodeURIComponent(qNick)}&select=pin,role`);
      }
      if (res && res.length > 0 && res[0].pin) expectedPin = String(res[0].pin).trim();
    } catch (e) {}
  }

  const isPinMatched = (inputPin === expectedPin) || 
                       (expectedPin === "0000" && inputPin === "000000") || 
                       (expectedPin === "000000" && inputPin === "0000");

  if (!isPinMatched) {
    document.getElementById("loginPinInput").value = "";
    document.getElementById("loginPinInput").focus();
    return showKakaoToast("비밀번호가 올바르지 않습니다! (6자리 숫자 PIN)", "❌");
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

  updateProfileUI(memberName);
  document.getElementById("guildLoginModal").style.display = "none";
  showKakaoToast(`[${memberName}] 님 반갑습니다!`, "🎉");

  resetAndReloadChatAfterAuth();
}

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

  if (typeof window.loadMainTabFriendsList === "function") window.loadMainTabFriendsList();
  if (typeof window.loadMainTabRoomsList === "function") window.loadMainTabRoomsList();
}

window.updateProfileUI = function(nick) {
  myCurrentNick = nick || localStorage.getItem("guild_my_nickname") || "";
  myCurrentAvatar = localStorage.getItem("guild_my_avatar") || "👤";
  myCurrentClass = localStorage.getItem("guild_my_class") || "직업 설정하기";

  const nickElem = document.getElementById("sidebarUserNickName");
  const avatarElem = document.getElementById("sidebarAvatarIcon");
  const classElem = document.getElementById("sidebarUserClassText");

  if (nickElem) nickElem.innerText = myCurrentNick || "로그인 필요";
  if (avatarElem) avatarElem.innerText = myCurrentAvatar;
  if (classElem) classElem.innerText = myCurrentClass;

  const tabNick = document.getElementById("mainTabMyNick");
  const tabAvatar = document.getElementById("mainTabMyAvatar");
  const tabClass = document.getElementById("mainTabMyClass");

  if (tabNick) tabNick.innerText = myCurrentNick || "내 프로필";
  if (tabAvatar) tabAvatar.innerText = myCurrentAvatar;
  if (tabClass) tabClass.innerText = myCurrentClass;
};
function updateProfileUI(nick) { window.updateProfileUI(nick); }

// --------------------------------------------------------
// 5. 과거 대화 로드 (대규모 최적화 & 완벽한 방 격리)
// --------------------------------------------------------
async function loadPastChatMessages() {
  const activeRoom = window.currentActiveRoomId || "default_public";
  const chatContainer = document.getElementById("chatMessagesView");
  if (!chatContainer) return;

  // 1) 로컬 캐시에서 먼저 복원 (깜빡임 및 증발 방지)
  const cacheKey = "chat_history_cache_" + activeRoom;
  let cachedMessages = [];
  try {
    cachedMessages = JSON.parse(sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey) || "[]");
  } catch(e) {}

  if (cachedMessages && cachedMessages.length > 0) {
    renderMessageHistoryList(cachedMessages);
  } else {
    chatContainer.innerHTML = `
      <div class="text-center my-1">
        <span class="badge bg-secondary bg-opacity-25 text-secondary px-2 py-1" style="font-size:0.65rem;">대화가 안전하게 연결되었습니다.</span>
      </div>
    `;
  }

  // 2) 서버 조회: 대규모 사용자(100~1000명)를 고려한 엄격한 방별 인덱스 쿼리
  try {
    let endpoint = "";
    if (activeRoom === "default_public") {
      endpoint = "guild_chats?or=(room_id.eq.default_public,room_id.is.null,room_id.eq.public)&order=id.desc&limit=100";
    } else {
      endpoint = `guild_chats?room_id=eq.${encodeURIComponent(activeRoom)}&order=id.desc&limit=100`;
    }

    let list = [];
    try {
      list = await apiRequest(endpoint);
    } catch (reqErr) {
      try {
        if (activeRoom === "default_public") {
          list = await apiRequest("guild_chats?room_id=eq.default_public&order=id.desc&limit=100");
          if (!list || list.length === 0) {
            const allFb = await apiRequest("guild_chats?order=id.desc&limit=100");
            list = (allFb || []).filter(m => !m.room_id || m.room_id === "default_public" || m.room_id === "public");
          }
        } else {
          list = await apiRequest(`guild_chats?room_id=eq.${encodeURIComponent(activeRoom)}&order=id.desc&limit=100`);
          if (!list || list.length === 0) {
            const allFb = await apiRequest("guild_chats?order=id.desc&limit=100");
            list = (allFb || []).filter(m => m.room_id === activeRoom);
          }
        }
      } catch (err2) {
        console.warn("Server chat fetch fallback failed:", err2);
      }
    }

    if (list && list.length > 0) {
      // 3) [이중 격리 방어]: 클라이언트 메모리 단에서 엄격한 방별 격리 필터링
      let filtered = list.filter(c => {
        const msgRoom = c.room_id || "default_public";
        if (activeRoom === "default_public") {
          return msgRoom === "default_public" || msgRoom === "public";
        } else {
          return msgRoom === activeRoom;
        }
      });

      const mergedMap = new Map();
      cachedMessages.forEach(m => { if (m.id) mergedMap.set(String(m.id), m); });
      filtered.forEach(m => { if (m.id) mergedMap.set(String(m.id), m); });

      const finalSorted = Array.from(mergedMap.values()).sort((a, b) => {
        const tA = new Date(a.created_at || 0).getTime() || 0;
        const tB = new Date(b.created_at || 0).getTime() || 0;
        return tA - tB;
      });

      const trimmed = finalSorted.slice(-100);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(trimmed));
        sessionStorage.setItem(cacheKey, JSON.stringify(trimmed));
      } catch(e) {}

      renderMessageHistoryList(trimmed);
    }
  } catch (e) {
    console.warn("loadPastChatMessages error:", e);
  }
}

function renderMessageHistoryList(msgList) {
  const chatContainer = document.getElementById("chatMessagesView");
  if (!chatContainer) return;

  chatContainer.innerHTML = `
    <div class="text-center my-1">
      <span class="badge bg-secondary bg-opacity-25 text-secondary px-2 py-1" style="font-size:0.65rem;">대화가 안전하게 연결되었습니다.</span>
    </div>
  `;

  let prevSender = null;
  msgList.forEach(c => {
    const isConsecutive = (c.sender_name === prevSender && c.msg_type === "chat");
    renderKakaoChatBubble(c, false, isConsecutive);
    prevSender = (c.msg_type === "chat") ? c.sender_name : null;
  });
  lastRenderedSender = prevSender;
  scrollChatBottom();
  if (typeof window.syncAllChatCutButtons === "function") window.syncAllChatCutButtons();
}

async function cleanupOldChatsBackground() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await apiRequest(`guild_chats?created_at=lt.${sevenDaysAgo}`, "DELETE");
  } catch (e) {}
}

// --------------------------------------------------------
// 실시간 대화 수신 (수천 명 트래픽 방어 & 다른 방 메시지 100% 차단)
// --------------------------------------------------------
function listenRealtimeChatMessages() {
  if (!supabaseClient) return;

  supabaseClient
    .channel("public:guild_chats")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "guild_chats" }, (payload) => {
      if (!payload.new) return;
      const newMsg = payload.new;
      const activeRoom = window.currentActiveRoomId || "default_public";
      const msgRoom = newMsg.room_id || "default_public";

      // 1) 해당 방 로컬 캐시에 즉시 보존
      try {
        const cacheKey = "chat_history_cache_" + msgRoom;
        let localMsgs = JSON.parse(sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey) || "[]");
        if (!localMsgs.find(m => String(m.id) === String(newMsg.id))) {
          localMsgs.push(newMsg);
          sessionStorage.setItem(cacheKey, JSON.stringify(localMsgs.slice(-100)));
          localStorage.setItem(cacheKey, JSON.stringify(localMsgs.slice(-100)));
        }
      } catch(e) {}

      // 2) [대규모 격리 가드]: 현재 화면에 띄운 방의 메시지가 아니면 100% 렌더링 차단!
      if (activeRoom === "default_public") {
        if (msgRoom !== "default_public" && msgRoom !== "public") {
          return;
        }
      } else {
        if (msgRoom !== activeRoom) {
          return;
        }
      }

      // 3) 내가 전송한 낙관적 메시지 중복 방어
      const optimisticIdx = pendingOptimisticMessages.findIndex(m => 
        m.sender_name === newMsg.sender_name && (m.message === newMsg.message || m.message === newMsg.message_text)
      );
      if (optimisticIdx !== -1) {
        pendingOptimisticMessages.splice(optimisticIdx, 1);
        scrollChatBottom();
        return;
      }

      // 4) 화면 렌더링 및 하단 자동 스크롤
      const isConsecutive = (newMsg.sender_name === lastRenderedSender && newMsg.msg_type === "chat");
      renderKakaoChatBubble(newMsg, true, isConsecutive);
      lastRenderedSender = (newMsg.msg_type === "chat") ? newMsg.sender_name : null;
      scrollChatBottom();
      if (typeof window.syncAllChatCutButtons === "function") window.syncAllChatCutButtons();

      // 5) [대규모 메모리 보호]: DOM 노드가 150개 초과 시 상단 오래된 노드 제거
      const container = document.getElementById("chatMessagesView");
      if (container && container.children.length > 150) {
        for (let i = 0; i < 20; i++) {
          if (container.firstElementChild && !container.firstElementChild.classList.contains("my-1")) {
            container.removeChild(container.firstElementChild);
          }
        }
      }
    })
    .subscribe();
}

// --------------------------------------------------------
// 6. 카카오톡 말풍선 렌더링 (1:1 안 읽은 숫자 1 보장)
// --------------------------------------------------------
function renderKakaoChatBubble(msg, doScroll = true, isConsecutive = false) {
  const container = document.getElementById("chatMessagesView");
  if (!container) return;

  const isMe = (myCurrentNick && (msg.sender_name === myCurrentNick));
  const isMentioned = Array.isArray(msg.mentions) && msg.mentions.includes(myCurrentNick);
  const msgKey = msg.id ? ("msg_" + msg.id) : ("msg_tmp_" + Math.floor(Math.random() * 10000000));
  const timeStr = formatKSTChatTime(msg.created_at);

  // [대규모 및 1:1 최적화]: 1:1 대화방은 총 인원이 무조건 2명! (나+상대방)
  const activeRoom = window.currentActiveRoomId || "default_public";
  const isDirect = activeRoom.startsWith("direct_") || (msg.room_id && msg.room_id.startsWith("direct_"));
  const totalMembers = isDirect ? 2 : ((cachedMemberList && cachedMemberList.length > 0) ? cachedMemberList.length : 10);
  let unreadCount = 0;

  if (Array.isArray(msg.read_members)) {
    unreadCount = Math.max(0, totalMembers - msg.read_members.length);
  } else if (isDirect) {
    unreadCount = isMe ? 1 : 0;
  } else if (msg.created_at) {
    const elapsedMin = Math.floor((Date.now() - new Date(msg.created_at).getTime()) / (1000 * 60));
    const readEstimate = Math.min(totalMembers, (isMe ? 1 : 0) + Math.max(0, Math.floor(elapsedMin * 0.8)));
    unreadCount = Math.max(0, totalMembers - readEstimate);
  } else {
    unreadCount = isMe ? Math.max(0, totalMembers - 1) : totalMembers;
  }

  const unreadSpanHtml = (unreadCount > 0) 
    ? `<span class="chat-unread-count" style="text-align:left !important;">${unreadCount}</span>` 
    : `<span class="chat-unread-count" style="display:none;"></span>`;

  let html = "";
  const cleanMessageText = (msg.message || msg.message_text || msg.content || '').trim();

  let senderAvatarIcon = (msg.sender_name || '?').charAt(0);
  const matchedSender = cachedMemberList.find(m => (m.name === msg.sender_name || m.nickname === msg.sender_name));
  if (matchedSender && matchedSender.job_class) {
    senderAvatarIcon = matchedSender.job_class.split(' ')[0] || senderAvatarIcon;
  }
  if (isMe) {
    senderAvatarIcon = myCurrentAvatar || senderAvatarIcon;
  }

  // 1) 보스 브리핑 카드
  if (msg.msg_type === "boss_briefing") {
    html = `
      <div class="chat-item-row other" id="${msgKey}">
        <div class="chat-sender-avatar">⏰</div>
        <div class="chat-msg-body">
          <div class="chat-sender-name"><span>보스알리미</span></div>
          <div class="chat-bubble-flex">
            <div class="boss-briefing-card">${cleanMessageText}</div>
            <div class="chat-meta-box" style="align-items:flex-start !important; text-align:left !important;">
              ${unreadSpanHtml}
              <span class="chat-timestamp">${timeStr}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  // 2) 토벌 알리미 카드 (raid_report)
  else if (msg.msg_type === "raid_report") {
    const raidId = msg.meta_data?.raid_id || Date.now();
    const bossName = msg.meta_data?.boss_name || "보스";
    const raidScore = msg.meta_data?.score || 1;
    const createdAtIso = msg.created_at || new Date().toISOString();

    html = `
      <div class="chat-item-row other" id="${msgKey}">
        <div class="chat-sender-avatar">⚔️</div>
        <div class="chat-msg-body">
          <div class="chat-sender-name"><span>토벌알리미</span></div>
          <div class="chat-bubble-flex">
            <div class="raid-report-card">
              <div class="raid-hero-box">
                <span class="raid-hero-badge"><i class="fa-solid fa-crown me-1"></i>토벌 성공</span>
                <span class="raid-hero-title">${bossName}</span>
                <span class="raid-hero-score">+${raidScore}점</span>
              </div>
              <div class="raid-report-body">${cleanMessageText}</div>
              <div class="raid-report-footer-row">
                <span class="raid-countdown-timer" id="raid_timer_${raidId}" data-raid-id="${raidId}" data-created-at="${createdAtIso}">
                  <i class="fa-regular fa-clock me-1"></i>3:00
                </span>
                <button type="button" class="btn btn-warning btn-sm fw-bold px-3 py-1" id="btn_raid_join_${raidId}" onclick="handleQuickRaidSelfAdd('${raidId}', '${bossName}')">
                  <i class="fa-solid fa-user-plus me-1"></i>나도 참여
                </button>
              </div>
            </div>
            <div class="chat-meta-box" style="align-items:flex-start !important; text-align:left !important;">
              ${unreadSpanHtml}
              <span class="chat-timestamp">${timeStr}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  // 3) 보스 즉시컷 / 젠 알림
  else if (msg.msg_type === "boss_alert") {
    const bossNameInMsg = extractBossNameFromMessage(cleanMessageText);
    const subCutBtn = bossNameInMsg ? `
      <button type="button" class="btn-chat-cut" id="btn_cut_${msgKey}" data-boss="${bossNameInMsg}" onclick="triggerQuickCutAction('${bossNameInMsg}', 'btn_cut_${msgKey}')">
        <i class="fa-solid fa-crosshairs"></i> 즉시컷
      </button>` : '';

    html = `
      <div class="chat-item-row other" id="${msgKey}">
        <div class="chat-sender-avatar">🚨</div>
        <div class="chat-msg-body">
          <div class="chat-sender-name"><span>보스알리미</span></div>
          <div class="chat-bubble-flex">
            <div>
              <div class="boss-alert-mini-card spawn-alert">${cleanMessageText}</div>
              ${subCutBtn}
            </div>
            <div class="chat-meta-box" style="align-items:flex-start !important; text-align:left !important;">
              ${unreadSpanHtml}
              <span class="chat-timestamp">${timeStr}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  // 4) 내가 작성한 메시지 (노란색 말풍선 우측 정렬)
  else if (isMe) {
    const consecutiveClass = isConsecutive ? "consecutive" : "";
    html = `
      <div class="chat-item-row me ${consecutiveClass}" id="${msgKey}">
        <div class="chat-msg-body">
          <div class="chat-bubble-flex">
            <div class="chat-meta-box" style="align-items:flex-start !important; text-align:left !important;">
              ${unreadSpanHtml}
              <span class="chat-timestamp">${timeStr}</span>
            </div>
            <div class="chat-bubble ${isMentioned ? 'border border-warning' : ''}">${formatMessageWithMentions(cleanMessageText)}</div>
          </div>
        </div>
      </div>
    `;
  }
  // 5) 상대방이 작성한 메시지
  else {
    const consecutiveClass = isConsecutive ? "consecutive" : "";
    const avatarStyle = isConsecutive ? "visibility: hidden;" : "";
    const nameBlock = isConsecutive ? "" : `<div class="chat-sender-name"><span>${escapeHtmlText(msg.sender_name)}</span></div>`;
    html = `
      <div class="chat-item-row other ${consecutiveClass}" id="${msgKey}">
        <div class="chat-sender-avatar" style="${avatarStyle}">${senderAvatarIcon}</div>
        <div class="chat-msg-body">
          ${nameBlock}
          <div class="chat-bubble-flex">
            <div class="chat-bubble ${isMentioned ? 'border border-warning' : ''}">${formatMessageWithMentions(cleanMessageText)}</div>
            <div class="chat-meta-box" style="align-items:flex-start !important; text-align:left !important;">
              ${unreadSpanHtml}
              <span class="chat-timestamp">${timeStr}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const tempWrapper = document.createElement("div");
  tempWrapper.innerHTML = html.trim();
  container.appendChild(tempWrapper.firstElementChild);

  if (doScroll) {
    scrollChatBottom();
  }
}

function formatMessageWithMentions(text) {
  if (!text) return "";
  return escapeHtmlText(text).replace(/@([a-zA-Z0-9가-힣_-]+)/g, '<span class="mention-tag">@$1</span>');
}

// --------------------------------------------------------
// 7. 메시지 입력 및 전송 제어 (전송버튼 노란색 활성화 & 최신 메시지 하단 스크롤 완벽 보장)
// --------------------------------------------------------
function handleInputState(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  const newH = Math.min(textarea.scrollHeight, 100);
  textarea.style.height = (newH > 36 ? newH : 36) + "px";

  // 전송 버튼 노란색 활성화 토글 (카카오톡 순정)
  const btn = document.getElementById("btnKakaoSend") || document.getElementById("btnSendChatMessage");
  if (btn) {
    if (textarea.value.trim().length > 0) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  }
}

function checkEnterKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    if (event.isComposing) return;
    event.preventDefault();
    handleSendMessage();
  }
}

async function handleSendMessage() {
  const inputElem = document.getElementById("inputChatMessage") || document.getElementById("chatMessageInput");
  if (!inputElem) return;
  const text = inputElem.value.trim();
  if (!text) return;

  if (!myCurrentNick) {
    myCurrentNick = localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "";
  }
  if (!myCurrentNick) {
    showKakaoToast("로그인이 필요합니다.", "⚠️");
    showGuildLoginModal();
    return;
  }

  // 멘션 감지
  const mentionMatches = text.match(/@([a-zA-Z0-9가-힣_-]+)/g);
  const detectedMentions = mentionMatches ? mentionMatches.map(m => m.slice(1)) : [];

  inputElem.value = "";
  handleInputState(inputElem);

  const targetRoomId = window.currentActiveRoomId || "default_public";
  const tempId = "tmp_" + Date.now();
  const optimisticMsg = {
    id: tempId,
    room_id: targetRoomId,
    sender_name: myCurrentNick,
    message: text,
    msg_type: "chat",
    mentions: detectedMentions,
    created_at: new Date().toISOString()
  };

  pendingOptimisticMessages.push(optimisticMsg);
  const isConsecutive = (myCurrentNick === lastRenderedSender);
  renderKakaoChatBubble(optimisticMsg, true, isConsecutive);
  scrollChatBottom();
  lastRenderedSender = myCurrentNick;

  // 로컬 캐시 즉시 보관
  try {
    const cacheKey = "chat_history_cache_" + targetRoomId;
    let localMsgs = JSON.parse(sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey) || "[]");
    localMsgs.push(optimisticMsg);
    sessionStorage.setItem(cacheKey, JSON.stringify(localMsgs.slice(-100)));
    localStorage.setItem(cacheKey, JSON.stringify(localMsgs.slice(-100)));
  } catch(e) {}

  try {
    const currentGid = localStorage.getItem("current_guild_id");
    const chatPayload = {
      sender_name: myCurrentNick,
      message: text,
      msg_type: "chat",
      room_id: targetRoomId
    };
    if (currentGid) chatPayload.guild_id = currentGid;
    if (detectedMentions && detectedMentions.length > 0) {
      chatPayload.mentions = detectedMentions;
    }

    let insertRes;
    try {
      insertRes = await apiRequest("guild_chats", "POST", [chatPayload]);
    } catch (postErr) {
      const minimalPayload = {
        sender_name: myCurrentNick,
        message: text,
        msg_type: "chat",
        room_id: targetRoomId
      };
      if (currentGid) minimalPayload.guild_id = currentGid;

      try {
        insertRes = await apiRequest("guild_chats", "POST", [minimalPayload]);
      } catch (finalErr) {
        let cleanErr = (finalErr && finalErr.message) ? finalErr.message : String(finalErr);
        try {
          const parsed = JSON.parse(cleanErr);
          if (parsed && parsed.message) cleanErr = parsed.message;
        } catch(e) {}
        throw new Error(cleanErr);
      }
    }

    if (insertRes && insertRes[0] && insertRes[0].id) {
      const realId = insertRes[0].id;
      const rowElem = document.getElementById("msg_" + tempId);
      if (rowElem) {
        rowElem.id = "msg_" + realId;
        rowElem.setAttribute("data-msg-id", realId);
      }
      try {
        const cacheKey = "chat_history_cache_" + targetRoomId;
        let localMsgs = JSON.parse(sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey) || "[]");
        const target = localMsgs.find(m => m.id === tempId);
        if (target) target.id = realId;
        sessionStorage.setItem(cacheKey, JSON.stringify(localMsgs));
        localStorage.setItem(cacheKey, JSON.stringify(localMsgs));
      } catch(e) {}
    }
  } catch (err) {
    showKakaoToast("전송 실패: " + err.message, "❌");
  }
}
window.handleSendMessage = window.executeSendMessage = handleSendMessage;

// --------------------------------------------------------
// 8. 멘션 팝업 자동완성
// --------------------------------------------------------
function bindMentionInputEvents() {
  const input = document.getElementById("inputChatMessage");
  const popup = document.getElementById("mentionPopupBox");
  if (!input || !popup) return;

  input.addEventListener("input", function() {
    const val = input.value;
    const cursorPos = input.selectionStart;
    const beforeText = val.slice(0, cursorPos);
    const atIdx = beforeText.lastIndexOf("@");

    if (atIdx !== -1 && !/\s/.test(beforeText.slice(atIdx + 1))) {
      const query = beforeText.slice(atIdx + 1).toLowerCase();
      const filtered = cachedMemberList.filter(m => {
        const n = m.name || m.nickname || "";
        return n.toLowerCase().startsWith(query);
      });

      if (filtered.length > 0) {
        popup.innerHTML = filtered.slice(0, 5).map(m => {
          const n = m.name || m.nickname;
          return `<div class="mention-item" onclick="applyMentionNick('${n}')">@${n}</div>`;
        }).join("");
        popup.style.display = "block";
      } else {
        closeMentionPopup();
      }
    } else {
      closeMentionPopup();
    }
  });
}

function applyMentionNick(name) {
  const input = document.getElementById("inputChatMessage");
  if (!input) return;
  const val = input.value;
  const cursorPos = input.selectionStart;
  const atIdx = val.slice(0, cursorPos).lastIndexOf("@");
  input.value = val.slice(0, atIdx) + `@${name} ` + val.slice(cursorPos);
  closeMentionPopup();
  input.focus();
}

function closeMentionPopup() {
  const popup = document.getElementById("mentionPopupBox");
  if (popup) popup.style.display = "none";
}

// --------------------------------------------------------
// 9. 서브 모듈 화면 오버레이 로더
// --------------------------------------------------------
window.openModulePage = async function(pageName) {
  if (pageName === "PageMembers") {
    closeAllDrawers();
    if (typeof window.closeModuleOverlay === "function") window.closeModuleOverlay();
    toggleMembersDrawer(true);
    return;
  }

  closeAllDrawers();

  const myRole = localStorage.getItem("guild_my_role") || "일반";
  const adminRole = sessionStorage.getItem("admin_role") || "";
  const isSuper = (adminRole === "super");
  const isAdmin = isSuper || (adminRole === "admin") || (myRole === "길드장" || myRole === "길마" || myRole === "부길드장" || myRole === "부길마");
  const isElite = isAdmin || (adminRole === "elite") || (myRole === "정예");

  if (pageName === 'PageSettings' && !isAdmin) {
    return showKakaoToast("설정 페이지는 관리자만 접근할 수 있습니다.", "⚠️");
  }
  if (pageName === 'PageFinance' && !isAdmin) {
    return showKakaoToast("길드비용현황은 관리자 전용 메뉴입니다.", "⚠️");
  }
  if (pageName === 'PageRegister' && !isElite) {
    return showKakaoToast("보스참여등록은 정예 이상만 접근할 수 있습니다.", "⚠️");
  }

  const overlay = document.getElementById("moduleOverlay");
  const body = document.getElementById("overlayBodyContent");
  const navTitle = document.getElementById("overlayNavTitle");

  const titleMap = {
    "PageNotice": "공지사항",
    "PageRegister": "보스참여등록",
    "PageRecords": "보스참여자",
    "PageWish": "분배희망신청",
    "PageSettle": "정산내역",
    "PageFinance": "길드비용현황",
    "PageSettings": "시스템 설정"
  };

  if (navTitle) navTitle.innerText = titleMap[pageName] || "기능 화면";
  if (overlay) overlay.style.display = "flex";
  if (body) body.innerHTML = `<div class="text-secondary small text-center py-5"><i class="fa-solid fa-spinner fa-spin me-2"></i>화면을 불러오는 중...</div>`;

  try {
    let res = await fetch(`pages/${pageName}.html?_t=${Date.now()}`);
    if (!res.ok) res = await fetch(`pages/${pageName}.htm?_t=${Date.now()}`);
    if (!res.ok) throw new Error("로드 실패");
    const html = await res.text();
    if (body) body.innerHTML = html;

    document.querySelectorAll(".module-dynamic-script").forEach(s => s.remove());
    body.querySelectorAll("script").forEach(s => {
      const newScript = document.createElement("script");
      newScript.className = "module-dynamic-script";
      if (s.src) newScript.src = s.src;
      else newScript.textContent = s.textContent;
      document.body.appendChild(newScript);
    });
  } catch (err) {
    if (body) body.innerHTML = `<div class="text-danger small text-center py-5">화면 로드 실패: ${err.message}</div>`;
  }
};

window.closeModuleOverlay = function() {
  const overlay = document.getElementById("moduleOverlay");
  if (overlay) overlay.style.display = "none";
};

// --------------------------------------------------------
// 10. 대화 검색 및 다중 타이머 바닥 스크롤 유틸
// --------------------------------------------------------
function scrollChatBottom(smooth = false) {
  const container = document.getElementById("chatMessagesView");
  if (!container) return;

  const doScroll = () => {
    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? "smooth" : "auto"
    });
  };

  doScroll();
  requestAnimationFrame(doScroll);
  setTimeout(doScroll, 40);
  setTimeout(doScroll, 120);
}

function escapeHtmlText(t) {
  if (!t) return "";
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

window.toggleChatSearchBar = function(forceState) {
  const area = document.getElementById("chatSearchBarArea");
  if (!area) return;
  const isShow = (forceState !== undefined) ? forceState : (area.style.display === "none");
  area.style.display = isShow ? "block" : "none";
  if (isShow) {
    const input = document.getElementById("chatSearchKeywordInput");
    if (input) {
      input.value = "";
      setTimeout(() => input.focus(), 100);
    }
  } else {
    window.clearChatSearch();
  }
};

window.handleSearchChatMessages = function(rawKeyword) {
  const keyword = (rawKeyword || "").trim().toLowerCase();
  const rows = document.querySelectorAll("#chatMessagesView .chat-item-row");
  let matchCount = 0;

  rows.forEach(r => {
    const text = (r.innerText || "").toLowerCase();
    if (!keyword) {
      r.style.display = "";
    } else if (text.includes(keyword)) {
      r.style.display = "";
      matchCount++;
    } else {
      r.style.display = "none";
    }
  });

  const countElem = document.getElementById("chatSearchMatchCount");
  if (countElem) countElem.innerText = keyword ? `${matchCount}건 일치` : "";
};

window.clearChatSearch = function() {
  const input = document.getElementById("chatSearchKeywordInput");
  if (input) input.value = "";
  window.handleSearchChatMessages("");
};

function setupPwaInstallation() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById("btnPwaInstall");
    if (btn) {
      btn.style.display = "inline-flex";
      btn.onclick = async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt = null;
        btn.style.display = "none";
      };
    }
  });
}

// 앱 실행 진입점
window.addEventListener("DOMContentLoaded", initApp);
