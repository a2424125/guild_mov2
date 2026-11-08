// ========================================================
// [길드톡 메신저] 메인 클라이언트 스크립트 (script.js)
// 카카오톡 인터페이스 / OS 네이티브 트레이 알림 / 1 숫자 보존 / 3일 사진 만료 / 실시간 스트림
// ========================================================

var supabaseClient = null;
var cachedMemberList = [];
var myCurrentNick = localStorage.getItem("guild_my_nickname") || "";
var myCurrentPin = localStorage.getItem("guild_my_pin") || "";
var myCurrentAvatar = localStorage.getItem("guild_my_avatar") || "👤";
var myCurrentClass = localStorage.getItem("guild_my_class") || "직업 설정하기";
var deferredPrompt = null;
var kakaoToastTimer = null;
var pendingOptimisticMessages = [];
var lastRenderedSender = null;
var activeRealtimeChatChannel = null;

// 창 활성화 상태 정밀 추적 변수
var isWindowCurrentlyFocused = true;

window.addEventListener("focus", function() {
  isWindowCurrentlyFocused = true;
  const isInChatView = (document.getElementById("chatRoomView") && document.getElementById("chatRoomView").style.display === "flex");
  if (isInChatView && window.currentActiveRoomId) {
    if (typeof window.markRoomAsReadNow === "function") {
      window.markRoomAsReadNow(window.currentActiveRoomId);
    }
    syncCurrentRoomAllUnreadToServer();
  }
});

window.addEventListener("blur", function() {
  isWindowCurrentlyFocused = false;
});

// --------------------------------------------------------
// 1. 공통 토스트 및 시간 포맷 유틸리티
// --------------------------------------------------------
function showKakaoToast(msg, icon = "💬") {
  const box = document.getElementById("kakaoToastBox");
  const m = document.getElementById("kakaoToastMsg");
  const ic = document.getElementById("kakaoToastIcon");
  if (!box) return;

  box.style.zIndex = "10000010";
  if (m) m.innerText = msg;
  if (ic) ic.innerText = icon;
  box.classList.add("show");

  if (kakaoToastTimer) clearTimeout(kakaoToastTimer);
  kakaoToastTimer = setTimeout(() => box.classList.remove("show"), 2600);
}
window.showKakaoToast = showKakaoToast;

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
// 1-B. ⭐️ [윈도우 OS 순정 트레이 알림 & 알림음 엔진]
// --------------------------------------------------------
function isUserActivelyFocusedOnRoom(msgRoomId) {
  if (!isWindowCurrentlyFocused || document.hidden || document.visibilityState === 'hidden') {
    return false;
  }
  const chatView = document.getElementById("chatRoomView");
  if (!chatView || chatView.style.display === 'none') {
    return false;
  }
  const activeRoom = window.currentActiveRoomId || "default_public";
  const targetRoom = (!msgRoomId || msgRoomId === "public" || msgRoomId === "default_public") ? "default_public" : msgRoomId;

  return (activeRoom === targetRoom);
}

window.triggerChatAlarmSound = function(msgRoomId) {
  const isEnabled = localStorage.getItem("guild_chat_alarm_enabled") !== "false";
  if (!isEnabled) return;

  if (isUserActivelyFocusedOnRoom(msgRoomId)) return;

  const soundFile = localStorage.getItem("guild_chat_alarm_sound") || "alarm3.mp3";
  const audioPath = soundFile.startsWith("http") ? soundFile : `/assets/sounds/${soundFile}`;

  try {
    const audio = new Audio(audioPath);
    audio.volume = 0.85;
    audio.play().catch(() => {
      playFallbackChatBeep();
    });
  } catch (e) {
    playFallbackChatBeep();
  }
};

function playFallbackChatBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1050, ctx.currentTime);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {}
}

// ⭐️ [핵심] Electron 네이티브 윈도우 알림 IPC 호출 (100% 확실한 트레이 팝업)
function notifyWebDesktopMessage(sender, msgText, msgRoomId) {
  const isEnabled = localStorage.getItem("guild_chat_alarm_enabled") !== "false";
  if (!isEnabled) return;

  // 내가 직접 창을 열어보고 있는 상태면 알림 스킵
  if (isUserActivelyFocusedOnRoom(msgRoomId)) return;

  // 1. Electron 데스크톱 앱 환경인 경우: 윈도우 OS 순정 트레이 알림 100% 발송
  if (window.electronAPI && typeof window.electronAPI.showNativeNotification === 'function') {
    window.electronAPI.showNativeNotification(`[${sender}]`, msgText || "새 메시지가 도착했습니다.", msgRoomId);
    return;
  }

  // 2. 일반 웹 브라우저 환경인 경우: Web Notification API 백업 호출
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try {
      const noti = new Notification(`💬 [${sender}]`, {
        body: msgText || "새 메시지가 도착했습니다.",
        icon: "/favicon.ico",
        silent: true
      });
      noti.onclick = function() {
        window.focus();
        if (msgRoomId && typeof window.openChatRoom === 'function') {
          window.openChatRoom(msgRoomId);
        }
      };
    } catch (e) {}
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission();
  }
}

// --------------------------------------------------------
// 2. 테마 설정 및 앱 초기화 진입점
// --------------------------------------------------------
window.applyAppTheme = function(mode) {
  const theme = mode || localStorage.getItem("guild_theme_mode") || "light";
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

window.applyFontScale = function(scale) {
  const s = scale || localStorage.getItem("guild_font_scale") || "md";
  document.body.classList.remove("font-scale-sm", "font-scale-md", "font-scale-lg");
  document.body.classList.add(`font-scale-${s}`);
};

window.addEventListener("storage", function(e) {
  if (e.key === "guild_theme_mode") window.applyAppTheme(e.newValue);
  if (e.key === "guild_font_scale") window.applyFontScale(e.newValue);
});

async function initApp() {
  if (typeof window.applyAppTheme === 'function') window.applyAppTheme();
  if (typeof window.applyFontScale === 'function') window.applyFontScale();

  if (window.supabase && typeof SUPABASE_CONFIG !== 'undefined') {
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
    window.supabaseClient = supabaseClient;
  }

  myCurrentNick = localStorage.getItem("guild_my_nickname") || "";
  myCurrentPin = localStorage.getItem("guild_my_pin") || "";
  myCurrentClass = localStorage.getItem("guild_my_class") || "직업 설정하기";
  myCurrentAvatar = localStorage.getItem("guild_my_avatar") || "👤";

  loadSaasGlobalNoticeAndFaq();

  // URL 파라미터로 개별 대화방 팝업으로 뜬 경우 검사
  const urlParams = new URLSearchParams(window.location.search);
  const isPopupMode = urlParams.has('open_room_id');

  const welcomeView = document.getElementById("welcomeGatewayView");
  const mainTabs = document.getElementById("kakaoMainTabsView");
  const chatView = document.getElementById("chatRoomView");

  if (!myCurrentNick) {
    if (welcomeView) welcomeView.style.display = "flex";
    if (mainTabs) mainTabs.style.display = "none";
    if (chatView) chatView.style.display = "none";
    document.body.classList.remove("in-main-tabs", "in-chat-room");
    if (typeof window.renderWelcomeJoinedGuilds === 'function') {
      window.renderWelcomeJoinedGuilds();
    }
    return;
  }

  if (isPopupMode) {
    if (welcomeView) welcomeView.style.display = "none";
    if (mainTabs) mainTabs.style.display = "none";
    if (chatView) chatView.style.display = "flex";
    document.body.classList.remove("in-main-tabs");
    document.body.classList.add("in-chat-room");
  } else {
    if (welcomeView) welcomeView.style.display = "none";
    if (mainTabs) mainTabs.style.display = "flex";
    document.body.classList.add("in-main-tabs");
  }

  await loadGuildSettings();
  await window.loadGuildMembersData();
  await refreshMyRoleFromServer();

  if (typeof window.loadBossTimersList === 'function') await window.loadBossTimersList();
  if (typeof window.startLocalBossWatchTimer === 'function') window.startLocalBossWatchTimer();

  listenRealtimeChatMessages();
  listenRealtimeRoleUpdates();
  if (typeof window.listenRealtimeBossTimers === 'function') window.listenRealtimeBossTimers();

  setupPwaInstallation();
  bindMentionInputEvents();
  bindClipboardImagePaste();
  cleanupOldImagesAndChatsBackground();

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  updateProfileUI(myCurrentNick);
  if (!isPopupMode) {
    if (typeof window.loadMainTabRoomsList === 'function') window.loadMainTabRoomsList();
    if (typeof window.loadMainTabFriendsList === 'function') window.loadMainTabFriendsList();
  }
  if (myCurrentPin === "000000" || myCurrentPin === "0000") {
    setTimeout(() => {
      openForceChangePinModal();
    }, 300);
  }
}

// --------------------------------------------------------
// 2-A. 시스템 공지 및 직책 동기화
// --------------------------------------------------------
async function loadSaasGlobalNoticeAndFaq() {
  if (typeof apiRequest !== "function") return;

  try {
    const notices = await apiRequest("saas_notices?is_active=eq.true&order=id.desc&limit=1");
    if (Array.isArray(notices) && notices.length > 0) {
      const latestNotice = notices[0];
      const gTitle = document.getElementById("gatewayNoticeTitle");
      const mTitle = document.getElementById("saasNoticeModalTitle");
      const mBody = document.getElementById("saasNoticeModalBody");

      if (gTitle && latestNotice.title) gTitle.innerText = `[공지] ${latestNotice.title}`;
      if (mTitle && latestNotice.title) mTitle.innerText = latestNotice.title;
      if (mBody && latestNotice.content) mBody.innerText = latestNotice.content;
    }
  } catch (e) {}

  try {
    const faqs = await apiRequest("saas_faqs?is_active=eq.true&order=sort_order.asc,id.asc");
    if (Array.isArray(faqs) && faqs.length > 0) {
      const container = document.getElementById("inAppFaqListContainer");
      if (container) {
        container.innerHTML = faqs.map(item => `
          <div class="faq-item">
            <div class="faq-q" onclick="toggleInAppFaq(this)">
              <span>Q. ${escapeHtmlText(item.question || '')}</span>
              <i class="fa-solid fa-chevron-down text-secondary" style="font-size: 0.65rem;"></i>
            </div>
            <div class="faq-a">${escapeHtmlText(item.answer || '')}</div>
          </div>
        `).join("");
      }
    }
  } catch (e) {}
}

async function refreshMyRoleFromServer() {
  const nick = localStorage.getItem("guild_my_nickname") || myCurrentNick || "";
  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
  if (!nick || typeof apiRequest !== "function") return;

  try {
    let rows = await apiRequest(`guild_members?guild_id=eq.${encodeURIComponent(currentGid)}&name=eq.${encodeURIComponent(nick)}&select=role,job_class,avatar`);
    if (!rows || rows.length === 0) {
      rows = await apiRequest(`guild_members?guild_id=eq.${encodeURIComponent(currentGid)}&nickname=eq.${encodeURIComponent(nick)}&select=role,job_class,avatar`);
    }

    if (rows && rows.length > 0) {
      const liveRole = (rows[0].role || "일반").trim();
      localStorage.setItem("guild_my_role", liveRole);

      if (rows[0].job_class) {
        myCurrentClass = rows[0].job_class;
        localStorage.setItem("guild_my_class", myCurrentClass);
      }
      if (rows[0].avatar) {
        myCurrentAvatar = rows[0].avatar;
        localStorage.setItem("guild_my_avatar", myCurrentAvatar);
      }

      if (liveRole === "길드장" || liveRole === "길마" || liveRole === "슈퍼관리자") {
        sessionStorage.setItem("admin_auth", "true");
        sessionStorage.setItem("admin_role", "super");
      } else if (liveRole === "부길드장" || liveRole === "부길마") {
        sessionStorage.setItem("admin_auth", "true");
        sessionStorage.setItem("admin_role", "admin");
      } else if (liveRole === "정예") {
        sessionStorage.setItem("admin_auth", "true");
        sessionStorage.setItem("admin_role", "elite");
      } else {
        sessionStorage.removeItem("admin_auth");
        sessionStorage.removeItem("admin_role");
      }
      updateProfileUI(nick);
    }
  } catch (e) {}
}
window.refreshMyRoleFromServer = refreshMyRoleFromServer;

function listenRealtimeRoleUpdates() {
  if (!supabaseClient) return;
  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
  const nick = localStorage.getItem("guild_my_nickname") || myCurrentNick || "";

  supabaseClient
    .channel("public:guild_members_roles")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "guild_members" }, (payload) => {
      if (!payload.new) return;
      if (payload.new.guild_id && payload.new.guild_id !== currentGid) return;

      const updatedName = payload.new.name || payload.new.nickname || "";
      if (updatedName === nick) {
        refreshMyRoleFromServer().then(() => {
          showKakaoToast(`내 직책이 [${payload.new.role || '일반'}] (으)로 실시간 반영되었습니다.`, "🛡️");
          if (typeof window.loadMainTabFriendsList === "function") window.loadMainTabFriendsList();
        });
      } else {
        if (typeof window.loadMainTabFriendsList === "function") window.loadMainTabFriendsList();
      }
    })
    .subscribe();
}

async function loadGuildSettings() {
  try {
    const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
    let joined = [];
    try { joined = JSON.parse(localStorage.getItem("my_joined_guilds") || "[]"); } catch(e) {}
    const currentGuild = joined.find(g => g.guild_id === currentGid);

    let gName = currentGuild?.guild_name || "길드";
    let gGame = currentGuild?.game_name || "";

    const gRows = await apiRequest(`guilds?id=eq.${encodeURIComponent(currentGid)}&select=id,guild_name,name,game_name`);
    if (Array.isArray(gRows) && gRows.length > 0) {
      gName = gRows[0].guild_name || gRows[0].name || gName;
      gGame = gRows[0].game_name || gGame;
    }

    const dynamicTitle = gGame ? `[${gGame}] ${gName}` : gName;

    const badge = document.getElementById("mainTabGameBadge");
    if (badge) {
      if (gGame) {
        badge.innerText = gGame;
        badge.style.display = "inline-block";
      } else {
        badge.style.display = "none";
      }
    }

    const t1 = document.getElementById("chatRoomTitle");
    const t2 = document.getElementById("menuGuildNameText");
    const t3 = document.getElementById("loginGuildTitle");
    const t4 = document.getElementById("mainTabHeaderSubtitle");

    if (t1 && !window.currentActiveRoomId) t1.innerText = dynamicTitle;
    if (t2) t2.innerText = dynamicTitle;
    if (t3) t3.innerText = `${dynamicTitle} 로그인`;
    if (t4) t4.innerText = dynamicTitle;
  } catch (e) {
    console.warn("loadGuildSettings error:", e);
  }
}

window.loadGuildMembersData = async function() {
  try {
    const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
    let members = [];
    try {
      members = await apiRequest("guild_members?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*");
    } catch (err) {
      members = [];
    }

    cachedMemberList = Array.isArray(members) ? members : [];
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
  } catch (e) {
    console.error("loadGuildMembersData error:", e);
  }
};

function getRolePriority(role) {
  const r = String(role || '').trim();
  if (r === '길드장' || r === '길마' || r === '슈퍼관리자') return 1;
  if (r === '부길드장' || r === '부길마') return 2;
  if (r === '정예') return 3;
  return 4;
}

// --------------------------------------------------------
// 3. 서랍 및 직업 모달 제어
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

// --------------------------------------------------------
// 4. 로그인 / 비밀번호 변경
// --------------------------------------------------------
window.executeForceChangePin = async function() {
  const in1 = document.getElementById("forceNewPinInput");
  const in2 = document.getElementById("forceNewPinConfirmInput");
  const newPin = (in1 ? in1.value : "").trim();
  const confirmPin = (in2 ? in2.value : "").trim();
  const myNick = localStorage.getItem("guild_my_nickname") || myCurrentNick || "";
  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");

  if (!newPin || newPin.length !== 6 || isNaN(Number(newPin))) {
    return showKakaoToast("새 비밀번호는 6자리 숫자로 입력해주세요.", "⚠️");
  }
  if (newPin === "000000" || newPin === "0000") {
    return showKakaoToast("초기 비밀번호(000000) 외의 숫자로 설정하세요.", "⚠️");
  }
  if (newPin !== confirmPin) {
    return showKakaoToast("입력하신 두 비밀번호가 일치하지 않습니다.", "❌");
  }

  try {
    if (typeof apiRequest === "function" && myNick) {
      try {
        await apiRequest(`guild_members?guild_id=eq.${encodeURIComponent(currentGid)}&nickname=eq.${encodeURIComponent(myNick)}`, "PATCH", { pin: newPin });
      } catch(e) {}
      try {
        await apiRequest(`guild_members?guild_id=eq.${encodeURIComponent(currentGid)}&name=eq.${encodeURIComponent(myNick)}`, "PATCH", { pin: newPin });
      } catch(e2) {}
    }

    myCurrentPin = newPin;
    localStorage.setItem("guild_my_pin", newPin);

    const modal = document.getElementById("modalForceChangePin");
    if (modal) modal.style.display = "none";
    showKakaoToast("비밀번호가 성공적으로 변경되었습니다!", "🎉");
  } catch (err) {
    showKakaoToast("비밀번호 변경 실패: " + err.message, "❌");
  }
};

async function executeGuildLogin(forcedGuildId = null) {
  const searchInput = document.getElementById("loginNickSearchInput");
  const selectedName = (searchInput && searchInput.value.trim()) || "";
  const inputPin = (document.getElementById("loginPinInput")?.value || "").trim();

  if (!selectedName) return showKakaoToast("캐릭터 닉네임을 입력해주세요!", "⚠️");
  if (!inputPin) return showKakaoToast("비밀번호(PIN)를 입력해주세요!", "⚠️");

  const chkAuto = document.getElementById("chkAutoLogin");
  const chkKeep = document.getElementById("chkKeepLogin");
  localStorage.setItem("raidon_auto_login", (chkAuto && chkAuto.checked) ? "true" : "false");
  localStorage.setItem("raidon_keep_login", (chkKeep && chkKeep.checked) ? "true" : "false");

  let candidates = [];
  try {
    let byNick = await apiRequest(`guild_members?nickname=ilike.${encodeURIComponent(selectedName)}&select=*`);
    let byName = await apiRequest(`guild_members?name=ilike.${encodeURIComponent(selectedName)}&select=*`);
    const map = new Map();
    (byNick || []).forEach(m => { if (m && m.id) map.set(m.id, m); });
    (byName || []).forEach(m => { if (m && m.id) map.set(m.id, m); });
    candidates = Array.from(map.values()).filter(m => (m.name || m.nickname || "").trim().toLowerCase() === selectedName.toLowerCase());
  } catch (err) {}

  if (candidates.length === 0) {
    return showKakaoToast("등록된 길드원을 찾을 수 없습니다.", "⚠️");
  }

  const pinMatchedList = candidates.filter(m => {
    const expected = m.pin ? String(m.pin).trim() : "000000";
    return (inputPin === expected) || (expected === "0000" && inputPin === "000000") || (expected === "000000" && inputPin === "0000");
  });

  if (pinMatchedList.length === 0) {
    return showKakaoToast("비밀번호(PIN)가 올바르지 않습니다!", "❌");
  }

  let targetMember = forcedGuildId ? pinMatchedList.find(m => (m.guild_id || "default") === forcedGuildId) : pinMatchedList[0];
  if (!targetMember) targetMember = pinMatchedList[0];

  const resolvedGid = targetMember.guild_id || "default";
  const memberName = targetMember.name || targetMember.nickname;
  const userRole = (targetMember.role || "일반").trim();

  localStorage.setItem("current_guild_id", resolvedGid);
  localStorage.setItem("guild_my_nickname", memberName);
  localStorage.setItem("guild_my_pin", inputPin);
  localStorage.setItem("guild_my_role", userRole);
  myCurrentNick = memberName;
  myCurrentPin = inputPin;

  if (targetMember.job_class) localStorage.setItem("guild_my_class", targetMember.job_class);
  if (targetMember.avatar) localStorage.setItem("guild_my_avatar", targetMember.avatar);

  updateProfileUI(memberName);
  document.querySelectorAll(".kakao-modal-backdrop").forEach(m => { m.style.display = "none"; });

  const welcomeView = document.getElementById("welcomeGatewayView");
  const mainTabs = document.getElementById("kakaoMainTabsView");
  if (welcomeView) welcomeView.style.display = "none";
  if (mainTabs) mainTabs.style.display = "flex";
  document.body.classList.add("in-main-tabs");

  resetAndReloadChatAfterAuth();
  showKakaoToast(`[${memberName}] 님 환영합니다!`, "🎉");
}
window.executeGuildLogin = executeGuildLogin;

function handleUserLogout() {
  localStorage.removeItem("guild_my_nickname");
  localStorage.removeItem("guild_my_pin");
  localStorage.removeItem("guild_my_role");
  localStorage.removeItem("raidon_auto_login");
  sessionStorage.clear();
  myCurrentNick = "";
  myCurrentPin = "";

  toggleMenuDrawer(false);
  const welcomeView = document.getElementById("welcomeGatewayView");
  const mainTabs = document.getElementById("kakaoMainTabsView");
  const chatView = document.getElementById("chatRoomView");

  if (mainTabs) mainTabs.style.display = "none";
  if (chatView) chatView.style.display = "none";
  if (welcomeView) welcomeView.style.display = "flex";
  document.body.classList.remove("in-main-tabs", "in-chat-room");

  if (typeof window.renderWelcomeJoinedGuilds === "function") {
    window.renderWelcomeJoinedGuilds();
  }
  showKakaoToast("로그아웃 되었습니다.", "👋");
}
window.handleUserLogout = handleUserLogout;

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
  listenRealtimeChatMessages();

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

// --------------------------------------------------------
// 5. ⭐️ [실시간 대화 스트림 & OS 알림 동기화 엔진]
// --------------------------------------------------------
function listenRealtimeChatMessages() {
  if (!supabaseClient) return;

  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
  const activeRoom = window.currentActiveRoomId || "default_public";
  const channelKey = `realtime_chat_${currentGid}_${activeRoom}`;

  if (activeRealtimeChatChannel) {
    supabaseClient.removeChannel(activeRealtimeChatChannel);
    activeRealtimeChatChannel = null;
  }

  activeRealtimeChatChannel = supabaseClient
    .channel(channelKey)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "guild_chats" }, (payload) => {
      if (!payload.new) return;
      const newMsg = payload.new;

      if (newMsg.guild_id && newMsg.guild_id !== currentGid) return;

      const rawMsgRoom = newMsg.room_id || "default_public";
      const normalizedMsgRoom = (rawMsgRoom === "public" || rawMsgRoom === "default_public") ? "default_public" : rawMsgRoom;
      const normalizedActiveRoom = (!window.currentActiveRoomId || window.currentActiveRoomId === "public" || window.currentActiveRoomId === "default_public") ? "default_public" : window.currentActiveRoomId;

      // ⭐️ 알림음 & 윈도우 OS 트레이 알림 (내가 창을 직접 보고 있는 상태가 아니면 100% 실행)
      if (newMsg.sender_name && newMsg.sender_name !== myCurrentNick) {
        window.triggerChatAlarmSound(normalizedMsgRoom);
        notifyWebDesktopMessage(newMsg.sender_name, (newMsg.msg_type === "image" ? "📷 사진을 보냈습니다." : (newMsg.message || "새 메시지")), normalizedMsgRoom);
      }

      if (typeof window.updateRoomCardRealtime === "function") {
        window.updateRoomCardRealtime(normalizedMsgRoom, newMsg);
      }

      try {
        const cacheKey = `chat_history_cache_${currentGid}_${normalizedMsgRoom}`;
        let localMsgs = JSON.parse(sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey) || "[]");
        if (!localMsgs.find(m => String(m.id) === String(newMsg.id))) {
          localMsgs.push(newMsg);
          sessionStorage.setItem(cacheKey, JSON.stringify(localMsgs.slice(-100)));
          localStorage.setItem(cacheKey, JSON.stringify(localMsgs.slice(-100)));
        }
      } catch(e) {}

      const isInChatView = (document.getElementById("chatRoomView") && document.getElementById("chatRoomView").style.display === "flex");
      if (!isInChatView || normalizedMsgRoom !== normalizedActiveRoom) return;

      // ⭐️ 창을 활성화해서 직접 보고 있을 때만 서버에 '읽음'을 전송하여 숫자 1을 지움!
      if (newMsg.sender_name && newMsg.sender_name !== myCurrentNick) {
        if (isUserActivelyFocusedOnRoom(normalizedMsgRoom)) {
          syncMyReadStatusToServer([newMsg]);
        }
      }

      const optimisticIdx = pendingOptimisticMessages.findIndex(m => 
        m.sender_name === newMsg.sender_name && (m.message === newMsg.message || m.id === newMsg.id)
      );
      if (optimisticIdx !== -1) {
        pendingOptimisticMessages.splice(optimisticIdx, 1);
        const rowElem = document.getElementById("msg_" + newMsg.id);
        if (rowElem) return;
      }

      const isConsecutive = (newMsg.sender_name === lastRenderedSender && (newMsg.msg_type === "chat" || newMsg.msg_type === "image"));
      renderKakaoChatBubble(newMsg, true, isConsecutive);
      lastRenderedSender = (newMsg.msg_type === "chat" || newMsg.msg_type === "image") ? newMsg.sender_name : null;
      scrollChatBottom();
      if (typeof window.syncAllChatCutButtons === "function") window.syncAllChatCutButtons();
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "guild_chats" }, (payload) => {
      if (!payload.new || !payload.new.id) return;
      const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
      if (payload.new.guild_id && payload.new.guild_id !== currentGid) return;

      const updated = payload.new;
      const rowElem = document.getElementById("msg_" + updated.id);
      if (!rowElem) return;
      const unreadSpan = rowElem.querySelector(".chat-unread-count");
      if (!unreadSpan) return;

      const activeRoom = window.currentActiveRoomId || "default_public";
      const isDirect = (window.currentActiveRoomType === "direct") || (activeRoom && activeRoom !== "default_public" && activeRoom.includes("-"));
      const totalMembers = isDirect ? 2 : ((cachedMemberList && cachedMemberList.length > 0) ? cachedMemberList.length : 2);
      const readerSet = new Set(Array.isArray(updated.read_members) ? updated.read_members : []);
      if (updated.sender_name) readerSet.add(updated.sender_name);
      if (myCurrentNick) readerSet.add(myCurrentNick);

      const newUnread = isDirect
        ? (updated.sender_name === myCurrentNick ? (readerSet.size >= 2 ? 0 : 1) : 0)
        : Math.max(0, totalMembers - readerSet.size);

      if (newUnread > 0) {
        unreadSpan.innerText = String(newUnread);
        unreadSpan.style.display = "";
      } else {
        unreadSpan.innerText = "";
        unreadSpan.style.display = "none";
      }
    })
    .subscribe();
}
window.listenRealtimeChatMessages = listenRealtimeChatMessages;

// --------------------------------------------------------
// 6. 과거 대화 로드 & 창 활성화 시 일괄 읽음 처리
// --------------------------------------------------------
async function loadPastChatMessages() {
  const isInChatView = (document.getElementById("chatRoomView") && document.getElementById("chatRoomView").style.display === "flex");
  const rawActiveRoom = window.currentActiveRoomId || "default_public";
  const activeRoom = (rawActiveRoom === "public") ? "default_public" : rawActiveRoom;
  const chatContainer = document.getElementById("chatMessagesView");
  if (!chatContainer) return;

  listenRealtimeChatMessages();

  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
  const cacheKey = `chat_history_cache_${currentGid}_${activeRoom}`;
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

  try {
    let list = await apiRequest(`guild_chats?guild_id=eq.${encodeURIComponent(currentGid)}&room_id=eq.${encodeURIComponent(activeRoom)}&select=*&order=id.desc&limit=150`);
    if (!list) list = [];

    const mergedMap = new Map();
    (cachedMessages || []).forEach(m => { if (m && m.id) mergedMap.set(String(m.id), m); });
    list.forEach(m => { if (m && m.id) mergedMap.set(String(m.id), m); });

    const finalSorted = Array.from(mergedMap.values()).sort((a, b) => {
      const tA = new Date(a.created_at || 0).getTime() || 0;
      const tB = new Date(b.created_at || 0).getTime() || 0;
      if (tA !== tB) return tA - tB;
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });

    if (finalSorted.length > 0) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify(finalSorted.slice(-100)));
        sessionStorage.setItem(cacheKey, JSON.stringify(finalSorted.slice(-100)));
      } catch(e) {}

      if (typeof window.markRoomAsReadNow === "function") {
        window.markRoomAsReadNow(activeRoom, finalSorted);
      }
      renderMessageHistoryList(finalSorted);

      if (isUserActivelyFocusedOnRoom(activeRoom)) {
        syncMyReadStatusToServer(finalSorted);
      }
    }
  } catch (e) {
    console.warn("loadPastChatMessages error:", e);
  }
}
window.loadPastChatMessages = loadPastChatMessages;

async function syncCurrentRoomAllUnreadToServer() {
  const activeRoom = window.currentActiveRoomId || "default_public";
  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
  const cacheKey = `chat_history_cache_${currentGid}_${activeRoom}`;
  try {
    const localMsgs = JSON.parse(sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey) || "[]");
    if (localMsgs.length > 0) {
      syncMyReadStatusToServer(localMsgs);
    }
  } catch(e) {}
}

async function syncMyReadStatusToServer(msgList) {
  if (!myCurrentNick || !Array.isArray(msgList) || msgList.length === 0) return;
  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");

  const toUpdate = msgList.filter(m => {
    if (!m || !m.id || String(m.id).startsWith("tmp_")) return false;
    const readers = Array.isArray(m.read_members) ? m.read_members : [];
    return !readers.includes(myCurrentNick);
  }).slice(-30);

  for (const m of toUpdate) {
    const readers = new Set(Array.isArray(m.read_members) ? m.read_members : []);
    if (m.sender_name) readers.add(m.sender_name);
    readers.add(myCurrentNick);
    const updatedArr = Array.from(readers);
    m.read_members = updatedArr;

    try {
      await apiRequest(`guild_chats?guild_id=eq.${encodeURIComponent(currentGid)}&id=eq.${encodeURIComponent(m.id)}`, "PATCH", {
        read_members: updatedArr
      });
    } catch (e) { break; }
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
    const isConsecutive = (c.sender_name === prevSender && (c.msg_type === "chat" || c.msg_type === "image"));
    renderKakaoChatBubble(c, false, isConsecutive);
    prevSender = (c.msg_type === "chat" || c.msg_type === "image") ? c.sender_name : null;
  });
  lastRenderedSender = prevSender;
  scrollChatBottom();
}

// --------------------------------------------------------
// 7. 📸 [사진 첨부 / 클립보드 붙여넣기 / 3일 만료 엔진]
// --------------------------------------------------------
function bindClipboardImagePaste() {
  const inputElem = document.getElementById("inputChatMessage") || document.getElementById("chatMessageInput");
  if (!inputElem) return;

  inputElem.addEventListener("paste", async (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          await processAndSendImage(file);
        }
        break;
      }
    }
  });
}

async function compressImageToWebp(file, maxWidth = 1280, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/webp", quality);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = readerEvent.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function processAndSendImage(file) {
  if (!myCurrentNick) {
    showKakaoToast("로그인이 필요합니다.", "⚠️");
    return;
  }

  showKakaoToast("사진 압축 및 전송 중...", "⏳");
  try {
    const compressedBase64 = await compressImageToWebp(file);
    const activeRoomKey = window.currentActiveRoomId || "default_public";
    const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
    const tempId = "tmp_" + Date.now();

    const imagePayload = {
      id: tempId,
      guild_id: currentGid,
      room_id: activeRoomKey,
      sender_name: myCurrentNick,
      message: "[사진]",
      media_url: compressedBase64,
      msg_type: "image",
      read_members: [myCurrentNick],
      expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString()
    };

    pendingOptimisticMessages.push(imagePayload);
    renderKakaoChatBubble(imagePayload, true, false);
    scrollChatBottom();

    const dbInsertData = {
      guild_id: currentGid,
      room_id: activeRoomKey,
      sender_name: myCurrentNick,
      message: "[사진]",
      media_url: compressedBase64,
      msg_type: "image",
      read_members: [myCurrentNick],
      created_at: new Date().toISOString()
    };

    const res = await apiRequest("guild_chats", "POST", [dbInsertData]);
    if (res && res[0] && res[0].id) {
      const realId = res[0].id;
      const rowElem = document.getElementById("msg_" + tempId);
      if (rowElem) rowElem.id = "msg_" + realId;
    }
    showKakaoToast("사진이 전송되었습니다! (3일 후 자동 만료)", "📷");
  } catch (err) {
    showKakaoToast("사진 전송 실패: " + err.message, "❌");
  }
}
window.processAndSendImage = processAndSendImage;

async function cleanupOldImagesAndChatsBackground() {
  try {
    const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await apiRequest(`guild_chats?guild_id=eq.${encodeURIComponent(currentGid)}&msg_type=eq.image&created_at=lt.${threeDaysAgo}`, "DELETE");
    
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    await apiRequest(`guild_chats?guild_id=eq.${encodeURIComponent(currentGid)}&created_at=lt.${fourteenDaysAgo}`, "DELETE");
  } catch (e) {}
}

// --------------------------------------------------------
// 8. 카카오톡 말풍선 렌더링
// --------------------------------------------------------
function renderKakaoChatBubble(msg, doScroll = true, isConsecutive = false) {
  const container = document.getElementById("chatMessagesView");
  if (!container) return;

  const isMe = (myCurrentNick && (msg.sender_name === myCurrentNick));
  const isMentioned = Array.isArray(msg.mentions) && msg.mentions.includes(myCurrentNick);
  const msgKey = msg.id ? ("msg_" + msg.id) : ("msg_tmp_" + Math.floor(Math.random() * 10000000));
  const timeStr = formatKSTChatTime(msg.created_at);

  const activeRoom = window.currentActiveRoomId || "default_public";
  const isDirect = (window.currentActiveRoomType === "direct") || (activeRoom && activeRoom !== "default_public" && activeRoom.includes("-"));
  const totalMembers = isDirect ? 2 : ((cachedMemberList && cachedMemberList.length > 0) ? cachedMemberList.length : 2);

  const readerSet = new Set(Array.isArray(msg.read_members) ? msg.read_members : []);
  if (msg.sender_name) readerSet.add(msg.sender_name);
  if (myCurrentNick && isMe) readerSet.add(myCurrentNick);

  let unreadCount = isDirect ? (!isMe ? 0 : (readerSet.size >= 2 ? 0 : 1)) : Math.max(0, totalMembers - readerSet.size);

  const unreadSpanHtml = (unreadCount > 0) 
    ? `<span class="chat-unread-count" style="text-align: ${isMe ? 'right' : 'left'} !important;">${unreadCount}</span>` 
    : `<span class="chat-unread-count" style="display:none;"></span>`;

  let html = "";
  const cleanMessageText = (msg.message || msg.message_text || msg.content || '').trim();

  let senderAvatarIcon = (msg.sender_name || '?').charAt(0);
  const matchedSender = (cachedMemberList || []).find(m => (m.name === msg.sender_name || m.nickname === msg.sender_name));
  if (matchedSender && matchedSender.job_class) {
    senderAvatarIcon = matchedSender.job_class.split(' ')[0] || senderAvatarIcon;
  }
  if (isMe) senderAvatarIcon = myCurrentAvatar || senderAvatarIcon;

  if (msg.msg_type === "image" || msg.media_url) {
    const imgContent = msg.media_url 
      ? `<img src="${msg.media_url}" style="max-width: 230px; max-height: 280px; border-radius: 10px; cursor: pointer; object-fit: cover; box-shadow: 0 2px 8px rgba(0,0,0,0.15);" onclick="openImagePreviewModal('${msg.media_url}')" title="클릭하여 확대">`
      : `<div class="p-2 text-secondary small bg-light rounded">[만료된 이미지입니다]</div>`;

    if (isMe) {
      html = `
        <div class="chat-item-row me" id="${msgKey}">
          <div class="chat-msg-body">
            <div class="chat-bubble-flex" style="display: flex; flex-direction: row; align-items: flex-end; justify-content: flex-end; gap: 4px;">
              <div class="chat-meta-box" style="display: flex; flex-direction: column; align-items: flex-end !important; text-align: right !important;">
                ${unreadSpanHtml}
                <span class="chat-timestamp" style="font-size: 0.65rem; color: #94a3b8; white-space: nowrap;">${timeStr}</span>
              </div>
              <div class="chat-bubble p-1" style="background: transparent !important; box-shadow: none !important;">${imgContent}</div>
            </div>
          </div>
        </div>
      `;
    } else {
      const consecutiveClass = isConsecutive ? "consecutive" : "";
      const avatarStyle = isConsecutive ? "visibility: hidden;" : "";
      const nameBlock = isConsecutive ? "" : `<div class="chat-sender-name"><span>${escapeHtmlText(msg.sender_name)}</span></div>`;
      html = `
        <div class="chat-item-row other ${consecutiveClass}" id="${msgKey}">
          <div class="chat-sender-avatar" style="${avatarStyle}">${senderAvatarIcon}</div>
          <div class="chat-msg-body">
            ${nameBlock}
            <div class="chat-bubble-flex" style="display: flex; flex-direction: row; align-items: flex-end; justify-content: flex-start; gap: 4px;">
              <div class="chat-bubble p-1" style="background: transparent !important; box-shadow: none !important;">${imgContent}</div>
              <div class="chat-meta-box" style="display: flex; flex-direction: column; align-items: flex-start !important; text-align: left !important;">
                ${unreadSpanHtml}
                <span class="chat-timestamp" style="font-size: 0.65rem; color: #94a3b8; white-space: nowrap;">${timeStr}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }
  }
  else if (msg.msg_type === "boss_briefing") {
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
  else if (isMe) {
    const consecutiveClass = isConsecutive ? "consecutive" : "";
    html = `
      <div class="chat-item-row me ${consecutiveClass}" id="${msgKey}">
        <div class="chat-msg-body">
          <div class="chat-bubble-flex" style="display: flex; flex-direction: row; align-items: flex-end; justify-content: flex-end; gap: 4px;">
            <div class="chat-meta-box" style="display: flex; flex-direction: column; align-items: flex-end !important; text-align: right !important; margin-bottom: 2px;">
              ${unreadSpanHtml}
              <span class="chat-timestamp" style="font-size: 0.65rem; color: #94a3b8; white-space: nowrap;">${timeStr}</span>
            </div>
            <div class="chat-bubble ${isMentioned ? 'border border-warning' : ''}">${formatMessageWithMentions(cleanMessageText)}</div>
          </div>
        </div>
      </div>
    `;
  }
  else {
    const consecutiveClass = isConsecutive ? "consecutive" : "";
    const avatarStyle = isConsecutive ? "visibility: hidden;" : "";
    const nameBlock = isConsecutive ? "" : `<div class="chat-sender-name"><span>${escapeHtmlText(msg.sender_name)}</span></div>`;
    html = `
      <div class="chat-item-row other ${consecutiveClass}" id="${msgKey}">
        <div class="chat-sender-avatar" style="${avatarStyle}">${senderAvatarIcon}</div>
        <div class="chat-msg-body">
          ${nameBlock}
          <div class="chat-bubble-flex" style="display: flex; flex-direction: row; align-items: flex-end; justify-content: flex-start; gap: 4px;">
            <div class="chat-bubble ${isMentioned ? 'border border-warning' : ''}">${formatMessageWithMentions(cleanMessageText)}</div>
            <div class="chat-meta-box" style="display: flex; flex-direction: column; align-items: flex-start !important; text-align: left !important; margin-bottom: 2px;">
              ${unreadSpanHtml}
              <span class="chat-timestamp" style="font-size: 0.65rem; color: #94a3b8; white-space: nowrap;">${timeStr}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const tempWrapper = document.createElement("div");
  tempWrapper.innerHTML = html.trim();
  container.appendChild(tempWrapper.firstElementChild);

  if (doScroll) scrollChatBottom();
}

function openImagePreviewModal(url) {
  let modal = document.getElementById("modalImagePreview");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modalImagePreview";
    modal.className = "kakao-modal-backdrop";
    modal.style.cssText = "display:none; z-index:99999999; background:rgba(0,0,0,0.85); align-items:center; justify-content:center; cursor:pointer;";
    modal.onclick = () => { modal.style.display = "none"; };
    modal.innerHTML = `<img id="previewModalImg" style="max-width:92vw; max-height:90vh; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.5);">`;
    document.body.appendChild(modal);
  }
  const img = document.getElementById("previewModalImg");
  if (img) img.src = url;
  modal.style.display = "flex";
}
window.openImagePreviewModal = openImagePreviewModal;

function formatMessageWithMentions(text) {
  if (!text) return "";
  return escapeHtmlText(text).replace(/@([a-zA-Z0-9가-힣_-]+)/g, '<span class="mention-tag">@$1</span>');
}

// --------------------------------------------------------
// 9. 메시지 입력 및 전송
// --------------------------------------------------------
function handleInputState(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  const newH = Math.min(textarea.scrollHeight, 100);
  textarea.style.height = (newH > 36 ? newH : 36) + "px";

  const btn = document.getElementById("btnKakaoSend") || document.getElementById("btnSendChatMessage");
  if (btn) {
    if (textarea.value.trim().length > 0) btn.classList.add("active");
    else btn.classList.remove("active");
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
    myCurrentNick = localStorage.getItem("guild_my_nickname") || "";
  }
  if (!myCurrentNick) {
    showKakaoToast("로그인이 필요합니다.", "⚠️");
    if (typeof showGuildLoginModal === "function") showGuildLoginModal();
    return;
  }

  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
  const rawActiveRoom = window.currentActiveRoomId || "default_public";
  const targetRoomId = (rawActiveRoom === "public") ? "default_public" : rawActiveRoom;

  inputElem.value = "";
  handleInputState(inputElem);

  const tempId = "tmp_" + Date.now();
  const optimisticMsg = {
    id: tempId,
    guild_id: currentGid,
    room_id: targetRoomId,
    sender_name: myCurrentNick,
    message: text,
    msg_type: "chat",
    read_members: [myCurrentNick],
    created_at: new Date().toISOString()
  };

  pendingOptimisticMessages.push(optimisticMsg);
  const isConsecutive = (myCurrentNick === lastRenderedSender);
  renderKakaoChatBubble(optimisticMsg, true, isConsecutive);
  scrollChatBottom();
  lastRenderedSender = myCurrentNick;

  try {
    const chatPayload = {
      guild_id: currentGid,
      room_id: targetRoomId,
      sender_name: myCurrentNick,
      message: text,
      msg_type: "chat",
      read_members: [myCurrentNick]
    };

    const insertRes = await apiRequest("guild_chats", "POST", [chatPayload]);
    if (insertRes && insertRes[0] && insertRes[0].id) {
      const realId = insertRes[0].id;
      const rowElem = document.getElementById("msg_" + tempId);
      if (rowElem) rowElem.id = "msg_" + realId;
    }
  } catch (err) {
    showKakaoToast("전송 실패: " + err.message, "❌");
  }
}
window.handleSendMessage = handleSendMessage;

// --------------------------------------------------------
// 10. 멘션 팝업 및 서브 모듈 오버레이
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
      const filtered = (cachedMemberList || []).filter(m => (m.name || m.nickname || "").toLowerCase().startsWith(query));

      if (filtered.length > 0) {
        popup.innerHTML = filtered.slice(0, 5).map(m => {
          const n = m.name || m.nickname;
          return `<div class="mention-item-row" onclick="applyMentionNick('${n}')">@${n}</div>`;
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

window.openModulePage = async function(pageName) {
  if (pageName === "PageMembers") {
    closeAllDrawers();
    if (typeof window.closeModuleOverlay === "function") window.closeModuleOverlay();
    toggleMembersDrawer(true);
    return;
  }

  closeAllDrawers();
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
      if (s.src) newScript.src = s.src; else newScript.textContent = s.textContent;
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
// 11. 스크롤 및 보조 유틸
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
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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
