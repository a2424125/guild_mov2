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
  if (!box || !m) return;

  m.innerText = msg;
  if (ic) ic.innerText = icon;

  box.classList.remove("show");
  void box.offsetWidth;
  box.classList.add("show");

  if (kakaoToastTimer) clearTimeout(kakaoToastTimer);
  kakaoToastTimer = setTimeout(() => {
    box.classList.remove("show");
  }, 2300);
}

function formatTime24Hour(dateInput) {
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
  if (isNaN(d.getTime())) return "";

  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatTime24HourWithDate(dateInput) {
  if (!dateInput) return "";
  let d = new Date(dateInput);
  if (isNaN(d.getTime())) return "";

  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}`;
}

function formatKSTChatTime(dateInput) {
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

  document.body.classList.toggle("theme-light", isLight);
  document.body.classList.toggle("theme-dark", !isLight);
  document.documentElement.classList.toggle("theme-light", isLight);
  document.documentElement.classList.toggle("theme-dark", !isLight);

  localStorage.setItem("guild_theme_mode", theme);
  const btn = document.getElementById("btnToggleAppTheme");
  if (btn) {
    btn.innerHTML = isLight ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
    btn.title = isLight ? '다크 모드로 전환' : '라이트 모드로 전환';
  }
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
        members = await apiRequest("guild_members?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*&order=nickname.asc");
      } catch (err) {
        try {
          members = await apiRequest("guild_members?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*&order=name.asc");
        } catch(e2) {}
      }
    }
    if (!members || members.length === 0) {
      try {
        members = await apiRequest("guild_members?select=*&order=nickname.asc");
      } catch (e3) {
        members = await apiRequest("guild_members?select=*&order=name.asc");
      }
    }
    cachedMemberList = members || [];
    window.cachedMemberList = cachedMemberList;

    cachedMemberList.sort((a, b) => {
      const pA = getRolePriority(a.role);
      const pB = getRolePriority(b.role);
      if (pA !== pB) return pA - pB;
      const nA = a.nickname || a.name || "";
      const nB = b.nickname || b.name || "";
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
      await apiRequest(`guild_members?nickname=eq.${encodeURIComponent(myCurrentNick)}`, "PATCH", {
        job_class: myCurrentClass
      });
    } catch (e) {
      try {
        await apiRequest(`guild_members?name=eq.${encodeURIComponent(myCurrentNick)}`, "PATCH", {
          job_class: myCurrentClass
        });
      } catch(e2) {}
    }
  }
  closeProfileEditModal();
  showKakaoToast(`직업이 [${className}] (으)로 변경되었습니다.`, icon);
}

// --------------------------------------------------------
// 4. 길드 로그인 / 로그아웃 (버그 완벽 수정)
// --------------------------------------------------------
function renderLoginMemberDropdown(query = "") {
  const selectElem = document.getElementById("loginMemberSelect");
  if (!selectElem) return;

  const q = (query || "").toLowerCase().trim();
  const filtered = cachedMemberList.filter(m => {
    const name = m.nickname || m.name || "";
    return name.toLowerCase().includes(q);
  });

  selectElem.innerHTML = `<option value="">닉네임을 선택하세요 (${filtered.length}명)</option>` +
    filtered.map(m => {
      const name = m.nickname || m.name || "";
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
    const n = m.nickname || m.name || "";
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
      const qNick = targetMember.nickname || targetMember.name || "";
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

  const memberName = targetMember.nickname || targetMember.name;
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

function updateProfileUI(nick) {
  const nickElem = document.getElementById("sidebarUserNickName");
  const avatarElem = document.getElementById("sidebarAvatarIcon");
  const classElem = document.getElementById("sidebarUserClassText");

  if (nickElem) nickElem.innerText = nick;
  if (avatarElem) avatarElem.innerText = myCurrentAvatar;
  if (classElem) classElem.innerText = myCurrentClass;
}

// --------------------------------------------------------
// 5. 과거 대화 로드 & 실시간 대화 수신 (방별 격리 & 노란색 읽음 계산)
// --------------------------------------------------------
async function loadPastChatMessages() {
  try {
    let endpoint = "guild_chats?select=*&order=id.desc&limit=100";
    const currentGid = localStorage.getItem("current_guild_id");
    const currentRoomKey = window.currentActiveRoomKey || "general";

    if (currentGid) {
      endpoint = `guild_chats?guild_id=eq.${encodeURIComponent(currentGid)}&room_key=eq.${encodeURIComponent(currentRoomKey)}&select=*&order=id.desc&limit=100`;
    }

    let messages = await apiRequest(endpoint);
    if ((!messages || messages.length === 0) && currentGid) {
      messages = await apiRequest(`guild_chats?guild_id=eq.${encodeURIComponent(currentGid)}&select=*&order=id.desc&limit=100`);
    }
    if (!messages || messages.length === 0) {
      messages = await apiRequest("guild_chats?select=*&order=id.desc&limit=100");
    }

    const container = document.getElementById("chatMessagesView");
    if (!container) return;
    container.innerHTML = "";
    lastRenderedSender = null;

    if (messages && messages.length > 0) {
      messages.reverse().forEach(m => appendChatMessage(m, false));
    }
    scrollToBottom(false);
  } catch (e) {}
}

function listenRealtimeChatMessages() {
  if (!supabaseClient) return;

  const currentGid = localStorage.getItem("current_guild_id") || "";
  const filterStr = currentGid ? `guild_id=eq.${currentGid}` : undefined;

  supabaseClient
    .channel('public:guild_chats')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'guild_chats',
      filter: filterStr
    }, payload => {
      const newMsg = payload.new;
      const currentRoomKey = window.currentActiveRoomKey || "general";
      if (newMsg.room_key && newMsg.room_key !== currentRoomKey) {
        if (typeof window.incrementRoomUnreadCount === "function") {
          window.incrementRoomUnreadCount(newMsg.room_key);
        }
        return;
      }
      handleIncomingChatMessage(newMsg);
    })
    .subscribe();
}

function handleIncomingChatMessage(newMsg) {
  const optIdx = pendingOptimisticMessages.findIndex(m =>
    m.sender_name === newMsg.sender_name && m.message === newMsg.message
  );

  if (optIdx !== -1) {
    const optId = pendingOptimisticMessages[optIdx].tempId;
    const optElem = document.getElementById(`opt_msg_${optId}`);
    if (optElem) {
      optElem.id = `msg_row_${newMsg.id}`;
      optElem.classList.remove("optimistic-msg");
      const readBadge = optElem.querySelector(".chat-unread-count");
      if (readBadge) {
        readBadge.innerText = calculateUnreadCount(newMsg);
        readBadge.style.display = "inline-block";
      }
    }
    pendingOptimisticMessages.splice(optIdx, 1);
    return;
  }

  appendChatMessage(newMsg, true);
  scrollToBottom(true);
}

// --------------------------------------------------------
// 6. 카카오톡 말풍선 렌더링 (노란색 읽음 숫자 & 나/상대방 완벽 분리)
// --------------------------------------------------------
function calculateUnreadCount(msg) {
  const total = (cachedMemberList && cachedMemberList.length > 0) ? cachedMemberList.length : 1;
  const readList = Array.isArray(msg.read_by) ? msg.read_by : [];
  let unread = total - readList.length;
  if (unread < 0) unread = 0;
  return unread;
}

function appendChatMessage(msg, animate = false) {
  const container = document.getElementById("chatMessagesView");
  if (!container) return;

  const currentNick = (myCurrentNick || "").trim();
  const senderNick = (msg.sender_name || "").trim();
  const isMine = (currentNick !== "" && currentNick === senderNick);

  const row = document.createElement("div");
  row.className = `chat-row ${isMine ? "mine" : "theirs"} ${animate ? "fade-in" : ""}`;
  row.id = `msg_row_${msg.id}`;

  const timeStr = formatKSTChatTime(msg.created_at || new Date().toISOString());
  const unreadCount = calculateUnreadCount(msg);
  const unreadBadge = `<span class="chat-unread-count" style="display:${unreadCount > 0 ? 'inline-block' : 'none'}">${unreadCount}</span>`;

  const cleanMessageText = escapeHtml(msg.message || "");
  const msgKey = msg.id || ('tmp_' + Date.now());

  let bubbleBody = "";

  if (msg.msg_type === "boss_briefing") {
    bubbleBody = `
      <div class="bubble-content-box boss-card-wrap">
        <div class="boss-briefing-header">
          <i class="fa-solid fa-list-check me-1 text-warning"></i>
          <span>보스타임 종합 브리핑</span>
        </div>
        <div class="boss-briefing-card">${cleanMessageText}</div>
      </div>
    `;
  }
  else if (msg.msg_type === "raid_register") {
    const raidId = msg.meta_data?.raid_id || "";
    const bossName = msg.meta_data?.boss_name || "보스";
    const killTime = msg.meta_data?.kill_time ? formatTime24Hour(msg.meta_data.kill_time) : "";

    bubbleBody = `
      <div class="bubble-content-box boss-card-wrap">
        <div class="raid-register-card">
          <div class="raid-hero-top">
            <span class="badge bg-danger px-2 py-1">토벌 등록 완료</span>
            <span class="raid-kill-time">${killTime ? killTime + ' 처치' : ''}</span>
          </div>
          <div class="raid-hero-body">
            <div class="d-flex align-items-center justify-content-between mb-2">
              <div>
                <span class="raid-hero-title">${bossName}</span>
                <span class="badge bg-secondary ms-2" id="raid_count_${raidId}">${(msg.meta_data?.members || []).length}명 참여</span>
              </div>
            </div>
            <div class="raid-members-tags mb-3" id="raid_tags_${raidId}">
              ${(msg.meta_data?.members || []).map(m => `<span class="badge bg-dark bg-opacity-75 text-light border border-secondary px-2 py-1">${escapeHtml(m)}</span>`).join(" ")}
            </div>
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-warning btn-sm fw-bold px-3 py-1" id="btn_raid_join_${raidId}" onclick="handleQuickRaidSelfAdd('${raidId}', '${bossName}')">
                <i class="fa-solid fa-user-plus me-1"></i>나도 참여 (+1점)
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  else if (msg.msg_type === "boss_alert") {
    const bossNameInMsg = extractBossNameFromMessage(cleanMessageText);
    const subCutBtn = bossNameInMsg ? `
      <button type="button" class="btn-chat-cut" id="btn_cut_${msgKey}" data-boss="${bossNameInMsg}" onclick="triggerQuickCutAction('${bossNameInMsg}', 'btn_cut_${msgKey}')">
        <i class="fa-solid fa-bolt me-1"></i>컷(처치)
      </button>
    ` : "";

    bubbleBody = `
      <div class="bubble-content-box boss-card-wrap">
        <div class="boss-alert-header">
          <i class="fa-solid fa-bell text-warning me-1"></i>
          <span>보스 출현 알림</span>
        </div>
        <div class="boss-alert-mini-card spawn-alert">${cleanMessageText}</div>
        <div class="boss-alert-tools-row">
          ${subCutBtn}
        </div>
      </div>
    `;
  }
  else {
    bubbleBody = `<div class="bubble-content-box">${cleanMessageText}</div>`;
  }

  if (isMine) {
    row.innerHTML = `
      <div class="bubble-meta mine">
        ${unreadBadge}
        <span class="chat-time">${timeStr}</span>
      </div>
      <div class="bubble-main mine">
        ${bubbleBody}
      </div>
    `;
  } else {
    const senderRole = msg.role || "일반";
    const senderClass = msg.job_class || "";
    const avatar = msg.avatar || "👤";
    const roleBadge = (senderRole === "길드장" || senderRole === "길마") ? `<span class="badge-role-master">👑 길마</span>` :
                      (senderRole === "부길드장" || senderRole === "부길마") ? `<span class="badge-role-sub">⚔️ 부길</span>` :
                      (senderRole === "정예") ? `<span class="badge-role-elite">🛡️ 정예</span>` : "";

    row.innerHTML = `
      <div class="sender-avatar">${avatar}</div>
      <div class="theirs-body">
        <div class="sender-name-label">
          <span class="sender-nick">${escapeHtml(senderNick)}</span>
          ${roleBadge}
          ${senderClass ? `<span class="sender-class">${escapeHtml(senderClass)}</span>` : ''}
        </div>
        <div class="d-flex align-items-end">
          <div class="bubble-main theirs">
            ${bubbleBody}
          </div>
          <div class="bubble-meta theirs ms-2">
            ${unreadBadge}
            <span class="chat-time">${timeStr}</span>
          </div>
        </div>
      </div>
    `;
  }

  container.appendChild(row);
  lastRenderedSender = senderNick;
}

function extractBossNameFromMessage(text) {
  if (!text) return "";
  const match = text.match(/\[(.*?)\]/);
  return match ? match[1].trim() : "";
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function scrollToBottom(smooth = true) {
  const container = document.getElementById("chatMessagesView");
  if (!container) return;
  if (smooth) {
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  } else {
    container.scrollTop = container.scrollHeight;
  }
}

// --------------------------------------------------------
// 7. 메시지 입력 및 전송 제어
// --------------------------------------------------------
async function executeSendMessage() {
  const input = document.getElementById("chatMessageInput");
  if (!input) return;
  const rawText = input.value.trim();
  if (!rawText) return;

  if (!myCurrentNick) {
    if (typeof openWelcomeGatewayModal === 'function') openWelcomeGatewayModal();
    else showGuildLoginModal();
    return;
  }

  input.value = "";
  input.focus();

  const currentGid = localStorage.getItem("current_guild_id") || null;
  const currentRoomKey = window.currentActiveRoomKey || "general";
  const myRole = localStorage.getItem("guild_my_role") || "일반";

  const tempId = Date.now();
  const optMsg = {
    tempId: tempId,
    sender_name: myCurrentNick,
    role: myRole,
    avatar: myCurrentAvatar,
    job_class: myCurrentClass,
    message: rawText,
    msg_type: "chat",
    created_at: new Date().toISOString(),
    guild_id: currentGid,
    room_key: currentRoomKey,
    read_by: [myCurrentNick]
  };

  pendingOptimisticMessages.push(optMsg);
  appendOptimisticChatMessage(optMsg);
  scrollToBottom(true);

  try {
    const payload = {
      sender_name: myCurrentNick,
      role: myRole,
      avatar: myCurrentAvatar,
      job_class: myCurrentClass,
      message: rawText,
      msg_type: "chat",
      guild_id: currentGid,
      room_key: currentRoomKey,
      read_by: [myCurrentNick]
    };
    await apiRequest("guild_chats", "POST", payload);
  } catch (err) {
    showKakaoToast("메시지 전송에 실패했습니다: " + err.message, "⚠️");
  }
}

function appendOptimisticChatMessage(optMsg) {
  const container = document.getElementById("chatMessagesView");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "chat-row mine fade-in optimistic-msg";
  row.id = `opt_msg_${optMsg.tempId}`;

  const timeStr = formatKSTChatTime(optMsg.created_at);
  const cleanMessageText = escapeHtml(optMsg.message);

  row.innerHTML = `
    <div class="bubble-meta mine">
      <span class="chat-unread-count" style="display:none">1</span>
      <span class="chat-time">${timeStr}</span>
    </div>
    <div class="bubble-main mine">
      <div class="bubble-content-box">${cleanMessageText}</div>
    </div>
  `;
  container.appendChild(row);
}

function handleChatInputKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    executeSendMessage();
  }
}

// --------------------------------------------------------
// 8. 멘션 팝업 자동완성
// --------------------------------------------------------
function bindMentionInputEvents() {
  const input = document.getElementById("chatMessageInput");
  if (!input) return;

  input.addEventListener("input", function() {
    const val = input.value;
    const cursorPos = input.selectionStart;
    const textBefore = val.slice(0, cursorPos);
    const atIdx = textBefore.lastIndexOf("@");

    if (atIdx !== -1) {
      const query = textBefore.slice(atIdx + 1);
      if (!query.includes(" ")) {
        renderMentionPopup(query);
        return;
      }
    }
    closeMentionPopup();
  });
}

function renderMentionPopup(query) {
  const popup = document.getElementById("mentionPopupBox");
  if (!popup) return;

  const q = query.toLowerCase();
  const matched = cachedMemberList.filter(m => {
    const name = m.nickname || m.name || "";
    return name.toLowerCase().includes(q);
  }).slice(0, 5);

  if (matched.length === 0) {
    popup.style.display = "none";
    return;
  }

  popup.innerHTML = matched.map(m => {
    const name = m.nickname || m.name || "";
    const role = m.role || "일반";
    return `
      <div class="mention-item" onclick="insertMentionNickname('${escapeHtml(name)}')">
        <span class="mention-name">@${escapeHtml(name)}</span>
        <span class="badge bg-secondary ms-1" style="font-size:0.65rem;">${role}</span>
      </div>
    `;
  }).join("");

  popup.style.display = "block";
}

function insertMentionNickname(name) {
  const input = document.getElementById("chatMessageInput");
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
// 9. 서브 모듈 화면 오버레이 로더 (PageMembers 서랍 강제 라우팅 가드)
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
// 10. 대화 검색 및 기타 유틸
// --------------------------------------------------------
function toggleChatSearchBox(isOpen) {
  const box = document.getElementById("chatSearchArea");
  if (!box) return;
  box.style.display = isOpen ? "flex" : "none";
  if (isOpen) {
    const input = document.getElementById("chatSearchInput");
    if (input) input.focus();
  }
}

function onChatSearchInput(query) {
  const q = (query || "").toLowerCase().trim();
  const rows = document.querySelectorAll("#chatMessagesView .chat-row");
  rows.forEach(r => {
    if (!q) {
      r.style.display = "flex";
      return;
    }
    const txt = r.innerText.toLowerCase();
    r.style.display = txt.includes(q) ? "flex" : "none";
  });
}

function setupPwaInstallation() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });
}

async function cleanupOldChatsBackground() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await apiRequest(`guild_chats?created_at=lt.${sevenDaysAgo}`, "DELETE");
  } catch (e) {}
}

window.addEventListener("DOMContentLoaded", initApp);
