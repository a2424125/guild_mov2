var supabaseClient = null;
var cachedMemberList = [];
var cachedBossList = [];
var myCurrentNick = localStorage.getItem("guild_my_nickname") || "";
var myCurrentPin = localStorage.getItem("guild_my_pin") || "";
var myCurrentAvatar = localStorage.getItem("guild_my_avatar") || "👤";
var myCurrentClass = localStorage.getItem("guild_my_class") || "미설정";
var bossWatcherInterval = null;
var deferredPrompt = null;
var kakaoToastTimer = null;
var pendingOptimisticMessages = [];
var lastRenderedSender = null;

var notifiedBossSpawnMap = new Set(JSON.parse(localStorage.getItem("boss_spawn_notified_keys") || "[]"));

function saveNotifiedBossKey(key) {
  if (!key) return;
  notifiedBossSpawnMap.add(key);
  const arr = Array.from(notifiedBossSpawnMap);
  if (arr.length > 200) arr.splice(0, arr.length - 200);
  localStorage.setItem("boss_spawn_notified_keys", JSON.stringify(arr));
}

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
    if (clean.includes(' ') && !clean.includes('T')) {
      clean = clean.replace(' ', 'T');
    }
    if (!clean.endsWith('Z') && !clean.includes('+') && !clean.includes('-')) {
      clean += 'Z';
    }
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
  if (e.key === "guild_theme_mode") {
    window.applyAppTheme(e.newValue);
  }
});

async function initApp() {
  if (typeof window.applyAppTheme === 'function') window.applyAppTheme();
  if (window.supabase && typeof SUPABASE_CONFIG !== 'undefined') {
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
  }

  await loadGuildMetadata();
  await loadTopNoticeHeader();
  await loadGuildMembersData();
  await loadBossTimersList();

  if (!myCurrentNick || !myCurrentPin) {
    showGuildLoginModal();
  } else {
    const isValid = await verifyStoredSession(myCurrentNick, myCurrentPin);
    if (isValid) {
      updateProfileUI(myCurrentNick);
    } else {
      showGuildLoginModal();
    }
  }

  await loadPastChatMessages();
  listenRealtimeChatMessages();
  listenRealtimeBossTimers();
  listenRealtimeBossParticipations();
  startLocalBossWatchTimer();
  startRaidReportCountdowns();
  cleanupOldChatsBackground();

  bindMentionInputEvents();
  setupPwaInstallation();
}

async function loadGuildMetadata() {
  try {
    const res = await apiRequest("guild_settings?select=key,value");
    if (res && res.length > 0) {
      res.forEach(item => {
        if (item.key === "guild_name" && item.value) {
          const gName = item.value;
          document.getElementById("menuGuildNameText").innerText = `${gName} 관리`;
          document.getElementById("chatRoomTitle").innerText = gName;
          document.getElementById("loginGuildTitle").innerText = `${gName} 길드 로그인`;
          document.title = gName;
        }
        if (item.key === "super_admin_pw" && item.value) {
          window.masterAdminPin = item.value;
        }
      });
    }
  } catch (e) {}
}

async function loadTopNoticeHeader() {
  try {
    const notices = await apiRequest("guild_notices?select=title,content&order=id.desc&limit=1");
    if (notices && notices.length > 0) {
      const item = notices[0];
      document.getElementById("kakaoTopNoticeText").innerText = `${item.title} - ${item.content}`;
    } else {
      document.getElementById("kakaoTopNoticeText").innerText = "등록된 공지사항이 없습니다.";
    }
  } catch (e) {}
}

async function loadBossTimersList() {
  try {
    const bosses = await apiRequest("boss_timers?select=*&order=id.asc");
    cachedBossList = bosses || [];
    syncAllChatCutButtons();
  } catch (e) {}
}

window.loadGuildMembersData = async function() {
  try {
    const members = await apiRequest("guild_members?select=*&order=name.asc");
    cachedMemberList = members || [];

    cachedMemberList.sort((a, b) => {
      const pA = getRolePriority(a.role);
      const pB = getRolePriority(b.role);
      if (pA !== pB) return pA - pB;
      return a.name.localeCompare(b.name, 'ko');
    });

    document.getElementById("roomMemberCountText").innerText = cachedMemberList.length;

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

function toggleMenuDrawer(isOpen) {
  const drawer = document.getElementById("menuSidebarDrawer");
  const backdrop = document.getElementById("commonDrawerBackdrop");
  if (isOpen) {
    toggleMembersDrawer(false);
    toggleBossDrawer(false);
    backdrop.classList.add("show");
    drawer.classList.add("open");
  } else {
    drawer.classList.remove("open");
    checkBackdropState();
  }
}

async function toggleMembersDrawer(isOpen) {
  const drawer = document.getElementById("membersSidebarDrawer");
  const backdrop = document.getElementById("commonDrawerBackdrop");
  if (isOpen) {
    toggleMenuDrawer(false);
    toggleBossDrawer(false);
    backdrop.classList.add("show");
    drawer.classList.add("open");

    const container = document.getElementById("drawerMembersContainer");
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
  } else {
    drawer.classList.remove("open");
    checkBackdropState();
  }
}

async function toggleBossDrawer(isOpen) {
  const drawer = document.getElementById("bossTimerSidebarDrawer");
  const backdrop = document.getElementById("commonDrawerBackdrop");
  if (isOpen) {
    toggleMenuDrawer(false);
    toggleMembersDrawer(false);
    backdrop.classList.add("show");
    drawer.classList.add("open");
    await loadDrawerPageTimer();
  } else {
    drawer.classList.remove("open");
    checkBackdropState();
    if (typeof window.__currentModuleCleanup === 'function') {
      window.__currentModuleCleanup();
    }
  }
}

async function loadDrawerPageTimer() {
  const area = document.getElementById("drawerBossListArea");
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

  await loadBossTimersList();
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
  const isMenuOpen = document.getElementById("menuSidebarDrawer").classList.contains("open");
  const isMembersOpen = document.getElementById("membersSidebarDrawer").classList.contains("open");
  const isBossOpen = document.getElementById("bossTimerSidebarDrawer").classList.contains("open");
  if (!isMenuOpen && !isMembersOpen && !isBossOpen) {
    document.getElementById("commonDrawerBackdrop").classList.remove("show");
  }
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

  document.getElementById("sidebarAvatarIcon").innerText = icon;
  document.getElementById("sidebarUserClassText").innerText = myCurrentClass;

  if (myCurrentNick) {
    try {
      await apiRequest(`guild_members?name=eq.${encodeURIComponent(myCurrentNick)}`, "PATCH", {
        job_class: myCurrentClass
      });
    } catch(e) {}
  }

  showKakaoToast(`내 직업이 [${myCurrentClass}]로 설정되었습니다!`, "🎉");
  closeProfileEditModal();
  await loadGuildMembersData();
}

async function verifyStoredSession(nick, pin) {
  const masterPin = window.masterAdminPin || "123456";
  if (nick === "슈퍼관리자" && (pin === "123456" || pin === masterPin)) {
    sessionStorage.setItem("admin_auth", "true");
    sessionStorage.setItem("admin_role", "super");
    myCurrentClass = "👑 슈퍼관리자";
    myCurrentAvatar = "👑";
    localStorage.setItem("guild_my_role", "슈퍼관리자");
    return true;
  }
  try {
    const res = await apiRequest(`guild_members?name=eq.${encodeURIComponent(nick)}&select=name,pin,role,job_class`);
    if (res && res.length > 0) {
      const dbPin = String(res[0].pin || '0000').trim();
      if (dbPin === String(pin).trim()) {
        if (res[0].job_class) {
          myCurrentClass = res[0].job_class;
          myCurrentAvatar = res[0].job_class.split(' ')[0] || "👤";
          localStorage.setItem("guild_my_class", myCurrentClass);
          localStorage.setItem("guild_my_avatar", myCurrentAvatar);
        }
        const userRole = res[0].role || "일반";
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
        return true;
      }
    }
  } catch (e) {}
  return false;
}

function renderLoginMemberDropdown(query = "") {
  const select = document.getElementById("loginMemberSelect");
  if (!select) return;
  const q = (query || "").trim().toLowerCase();
  const filtered = q
    ? cachedMemberList.filter(m => (m.name || "").toLowerCase().includes(q) || (m.role || "").toLowerCase().includes(q))
    : cachedMemberList;

  let html = '<option value="">' + (q ? `검색 결과 (${filtered.length}명)...` : '닉네임을 선택하세요...') + '</option>';
  html += filtered.map(m => `<option value="${m.name}" ${m.name === myCurrentNick ? 'selected' : ''}>${m.name} (${m.role || '일반'})</option>`).join('');
  select.innerHTML = html;

  if (filtered.length === 1 && q) {
    select.value = filtered[0].name;
  }
}

function onLoginSearchInput(val) {
  renderLoginMemberDropdown(val);
}

function onLoginSelectChange(val) {
  if (val) {
    const searchInput = document.getElementById("loginNickSearchInput");
    if (searchInput) searchInput.value = val;
  }
}

function showGuildLoginModal() {
  document.getElementById("guildLoginModal").style.display = "flex";
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
  const masterPin = window.masterAdminPin || "123456";

  if (isSuperId && (inputPin === "123456" || inputPin === masterPin)) {
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
    return showKakaoToast("👑 슈퍼관리자(Master)로 인증되었습니다.", "🎉");
  }

  const targetMember = cachedMemberList.find(m => m.name.toLowerCase() === selectedName.toLowerCase());
  if (!targetMember && isSuperId) {
    document.getElementById("loginPinInput").value = "";
    document.getElementById("loginPinInput").focus();
    return showKakaoToast("비밀번호가 올바르지 않습니다!", "❌");
  }

  if (!targetMember) {
    return showKakaoToast("등록된 길드원을 찾을 수 없습니다. 닉네임을 확인하세요.", "⚠️");
  }

  let expectedPin = "0000";
  if (targetMember.pin) {
    expectedPin = String(targetMember.pin).trim();
  } else {
    try {
      const res = await apiRequest(`guild_members?name=eq.${encodeURIComponent(targetMember.name)}&select=pin,role`);
      if (res && res.length > 0 && res[0].pin) {
        expectedPin = String(res[0].pin).trim();
      }
    } catch (e) {}
  }

  if (inputPin !== expectedPin) {
    document.getElementById("loginPinInput").value = "";
    document.getElementById("loginPinInput").focus();
    return showKakaoToast("비밀번호가 올바르지 않습니다! (초기값: 0000)", "❌");
  }

  myCurrentNick = targetMember.name;
  myCurrentPin = inputPin;
  localStorage.setItem("guild_my_nickname", targetMember.name);
  localStorage.setItem("guild_my_pin", inputPin);

  const userRole = targetMember.role || "일반";
  localStorage.setItem("guild_my_role", userRole);

  if (userRole === "길드장" || userRole === "길마") {
    sessionStorage.setItem("admin_auth", "true");
    sessionStorage.setItem("admin_role", "admin");
  } else if (userRole === "부길드장" || userRole === "부길마") {
    sessionStorage.setItem("admin_auth", "true");
    sessionStorage.setItem("admin_role", "admin");
  } else if (userRole === "정예") {
    sessionStorage.setItem("admin_auth", "true");
    sessionStorage.setItem("admin_role", "elite");
  } else {
    sessionStorage.removeItem("admin_auth");
    sessionStorage.removeItem("admin_role");
  }

  updateProfileUI(targetMember.name);
  document.getElementById("guildLoginModal").style.display = "none";
  showKakaoToast(`[${targetMember.name}] 님 반갑습니다!`, "🎉");
}

function handleUserLogout() {
  if (!confirm("정말로 로그아웃하시겠습니까?")) return;
  localStorage.removeItem("guild_my_nickname");
  localStorage.removeItem("guild_my_pin");
  localStorage.removeItem("guild_my_role");
  sessionStorage.removeItem("admin_auth");
  sessionStorage.removeItem("admin_role");
  myCurrentNick = "";
  myCurrentPin = "";
  toggleMenuDrawer(false);
  showGuildLoginModal();
}

function updateProfileUI(nick) {
  document.getElementById("sidebarUserNickName").innerText = nick;
  document.getElementById("sidebarAvatarIcon").innerText = myCurrentAvatar;
  document.getElementById("sidebarUserClassText").innerText = myCurrentClass;
}

async function loadPastChatMessages() {
  try {
    const list = await apiRequest("guild_chats?select=*&order=id.desc&limit=100");
    if (list && list.length > 0) {
      let prevSender = null;
      list.reverse().forEach(c => {
        const isConsecutive = (c.sender_name === prevSender && c.msg_type === "chat");
        renderKakaoChatBubble(c, false, isConsecutive);
        prevSender = c.msg_type === "chat" ? c.sender_name : null;
      });
      lastRenderedSender = prevSender;
      scrollChatBottom();
      syncAllChatCutButtons();
    }
  } catch (e) {}
}

async function cleanupOldChatsBackground() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await apiRequest(`guild_chats?created_at=lt.${sevenDaysAgo}`, "DELETE");
  } catch (e) {}
}

function listenRealtimeChatMessages() {
  if (!supabaseClient) return;

  supabaseClient
    .channel("public:guild_chats")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "guild_chats" }, (payload) => {
      const newMsg = payload.new;
      if (!newMsg) return;

      if (newMsg.sender_name === myCurrentNick && newMsg.msg_type === "chat") {
        const pendingIdx = pendingOptimisticMessages.findIndex(p => p.text === newMsg.message && (Date.now() - p.time < 15000));
        if (pendingIdx !== -1) {
          const pending = pendingOptimisticMessages[pendingIdx];
          pendingOptimisticMessages.splice(pendingIdx, 1);

          const rowElem = document.getElementById("msg_" + pending.tempId);
          if (rowElem) {
            rowElem.id = "msg_" + newMsg.id;
            rowElem.setAttribute("data-msg-id", newMsg.id);
          }
          lastRenderedSender = newMsg.sender_name;
          return;
        }
      }

      const isConsecutive = (newMsg.sender_name === lastRenderedSender && newMsg.msg_type === "chat");
      renderKakaoChatBubble(newMsg, true, isConsecutive);
      lastRenderedSender = newMsg.msg_type === "chat" ? newMsg.sender_name : null;
    })
    .subscribe();
}

function listenRealtimeBossTimers() {
  if (!supabaseClient) return;

  supabaseClient
    .channel("public:boss_timers")
    .on("postgres_changes", { event: "*", schema: "public", table: "boss_timers" }, (payload) => {
      if (payload.eventType === "UPDATE") {
        const idx = cachedBossList.findIndex(b => b.id === payload.new.id);
        if (idx !== -1) cachedBossList[idx] = payload.new;
        else cachedBossList.push(payload.new);
        syncAllChatCutButtons();
      } else if (payload.eventType === "INSERT") {
        cachedBossList.push(payload.new);
        syncAllChatCutButtons();
      } else if (payload.eventType === "DELETE") {
        cachedBossList = cachedBossList.filter(b => b.id !== payload.old.id);
        syncAllChatCutButtons();
      }
    })
    .subscribe();
}

function syncAllChatCutButtons() {
  const now = Date.now();
  const allCutButtons = document.querySelectorAll('.btn-msg-sub-cut');

  allCutButtons.forEach(btn => {
    const bossName = btn.getAttribute('data-boss-name');
    if (!bossName) return;

    const boss = cachedBossList.find(b => b.boss_name.toLowerCase() === bossName.toLowerCase());
    if (!boss || !boss.next_spawn_time) return;

    const diffSec = Math.floor((new Date(boss.next_spawn_time).getTime() - now) / 1000);

    if (diffSec > 0) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> 완료`;
      btn.classList.add("disabled");
    } else {
      if (!btn.classList.contains("disabled")) {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-skull"></i> 컷 처리`;
      }
    }
  });
}

function extractBossNameFromMessage(text) {
  if (!text) return "";
  const match = text.match(/\[([^\]]+)\]/);
  if (match && match[1]) return match[1].trim();
  return "";
}

function renderKakaoChatBubble(msg, isRealtime = true, isConsecutive = false) {
  const container = document.getElementById("chatMessagesView");
  const isMe = (msg.sender_name === myCurrentNick);
  const isMentioned = Array.isArray(msg.mentions) && msg.mentions.includes(myCurrentNick);
  const msgKey = msg.id ? ("msg_" + msg.id) : ("msg_tmp_" + Math.floor(Math.random() * 10000000));
  
  const timeStr = formatKSTChatTime(msg.created_at);
  const totalMembers = cachedMemberList.length || 52;
  const unreadCount = Math.max(1, totalMembers - 14);

  let html = "";
  const cleanMessageText = (msg.message || '').trim();

  let senderAvatarIcon = (msg.sender_name || '?').charAt(0);
  const matchedSender = cachedMemberList.find(m => m.name === msg.sender_name);
  if (matchedSender && matchedSender.job_class) {
    senderAvatarIcon = matchedSender.job_class.split(' ')[0] || senderAvatarIcon;
  }
  if (isMe) {
    senderAvatarIcon = myCurrentAvatar || senderAvatarIcon;
  }

  if (msg.msg_type === "boss_briefing") {
    html = `
      <div class="chat-item-row other" id="${msgKey}">
        <div class="chat-sender-avatar bot">⏰</div>
        <div class="chat-msg-body">
          <div class="chat-sender-name">보스알리미</div>
          <div class="chat-bubble-flex">
            <div class="boss-brief-bubble">
              ${cleanMessageText}
            </div>
            <div class="chat-meta-box">
              <span class="chat-unread-count">${unreadCount}</span>
              <span class="chat-timestamp">${timeStr}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  else if (msg.msg_type === "finance_report") {
    let cardContent = cleanMessageText.includes("finance-report-card") ? cleanMessageText : `<div class="finance-report-card">${cleanMessageText}</div>`;
    // 🎯 [길드명] 접두사 제거
    cardContent = cardContent.replace(/\[[^\]]+\]\s*(길드금고|금고)/g, "$1");
    html = `
      <div class="chat-item-row other" id="${msgKey}">
        <div class="chat-sender-avatar bot" style="background: rgba(251, 191, 36, 0.2) !important; border-color: #f59e0b !important; color: #d97706 !important;">🏛️</div>
        <div class="chat-msg-body raid-msg-body">
          <div class="chat-sender-name">금고알리미</div>
          <div class="chat-bubble-flex">
            ${cardContent}
            <div class="chat-meta-box">
              <span class="chat-unread-count">${unreadCount}</span>
              <span class="chat-timestamp">${timeStr}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  else if (msg.msg_type === "records_report" || (msg.sender_name === "통계알리미" || cleanMessageText.includes("records-report-card"))) {
    let cleanCard = cleanMessageText.includes("records-report-card") ? cleanMessageText : `<div class="records-report-card">${cleanMessageText}</div>`;
    // 🎯 [길드명] 접두사 제거: "[불편한사람들] 보스&전쟁 통계" -> "보스&전쟁 통계"
    cleanCard = cleanCard.replace(/\[[^\]]+\]\s*(보스&전쟁|보스 & 전쟁|통계)/g, "$1");
    html = `
      <div class="chat-item-row other" id="${msgKey}">
        <div class="chat-sender-avatar bot" style="background: rgba(14, 165, 233, 0.2) !important; border-color: #0284c7 !important; color: #0284c7 !important;">📊</div>
        <div class="chat-msg-body raid-msg-body">
          <div class="chat-sender-name">통계알리미</div>
          <div class="chat-bubble-flex">
            ${cleanCard}
            <div class="chat-meta-box">
              <span class="chat-unread-count">${unreadCount}</span>
              <span class="chat-timestamp">${timeStr}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  else if (msg.msg_type === "wish_report") {
    let wishData = null;
    try {
      wishData = typeof msg.message === "object" ? msg.message : JSON.parse(msg.message);
    } catch (e) {
      wishData = null;
    }

    if (!wishData) {
      html = `
        <div class="chat-item-row other" id="${msgKey}">
          <div class="chat-sender-avatar bot" style="background: rgba(56, 189, 248, 0.2) !important; border-color: #38bdf8 !important; color: #0284c7 !important;">🎁</div>
          <div class="chat-msg-body">
            <div class="chat-sender-name">정산알리미</div>
            <div class="chat-bubble-flex">
              <div class="chat-bubble">${formatMessageWithMentions(cleanMessageText)}</div>
              <div class="chat-meta-box">
                <span class="chat-unread-count">${unreadCount}</span>
                <span class="chat-timestamp">${timeStr}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      const bossName = wishData.boss_name || "보스";
      const itemName = wishData.item_name || "아이템";
      const winnerName = wishData.winner_name || "낙찰자";
      const price = Number(wishData.price || 0).toLocaleString();
      const perShare = Number(wishData.per_share || 0).toLocaleString();
      const memberCount = wishData.member_count || 0;
      const membersList = Array.isArray(wishData.members) ? wishData.members : [];
      const dateStr = wishData.date_str || "10/20";
      const reportTime = wishData.created_at ? formatKSTChatTime(wishData.created_at) : timeStr;

      html = `
        <div class="chat-item-row other" id="${msgKey}">
          <div class="chat-sender-avatar bot" style="background: rgba(56, 189, 248, 0.2) !important; border-color: #38bdf8 !important; color: #0284c7 !important;">🎁</div>
          <div class="chat-msg-body raid-msg-body">
            <div class="chat-sender-name">정산알리미</div>
            <div class="chat-bubble-flex">
              <div class="finance-report-card">
                <div class="fin-card-header">
                  <div class="fin-card-title">
                    <i class="fa-solid fa-gift text-warning"></i>
                    <span class="text-truncate">아이템 분배 영수증</span>
                  </div>
                  <span class="fin-date-badge">${dateStr}</span>
                </div>

                <div class="fin-vault-hero" style="background: linear-gradient(135deg, rgba(56, 189, 248, 0.12) 0%, rgba(56, 189, 248, 0.04) 100%) !important; border-color: rgba(56, 189, 248, 0.3) !important;">
                  <div style="min-width: 0; flex: 1; padding-right: 4px;">
                    <div class="fin-vault-label"><i class="fa-solid fa-box-open me-1 text-info"></i>낙찰 아이템</div>
                    <div class="fin-vault-val text-truncate" style="color: #38bdf8 !important; font-size: 12px !important;">[${escapeHtmlText(bossName)}] ${escapeHtmlText(itemName)}</div>
                  </div>
                  <div style="font-size: 1.2rem; flex-shrink: 0;">🎁</div>
                </div>

                <div class="fin-period-box" style="margin-bottom: 6px;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="color: var(--kakao-time-gray); font-size: 11px; font-weight: 600;">👑 낙찰자:</span>
                    <strong style="color: #fbbf24; font-size: 11.5px;">${escapeHtmlText(winnerName)} (${price} D)</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 4px; border-top: 1px dashed var(--drawer-card-border);">
                    <span style="color: var(--kakao-time-gray); font-size: 11px; font-weight: 600;">👥 분배 대상:</span>
                    <strong style="color: var(--kakao-notice-text); font-size: 11px;">참여자 ${memberCount}명</strong>
                  </div>
                </div>

                <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 7px; padding: 6px 9px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <span style="font-size: 11px; font-weight: 700; color: var(--kakao-notice-text);">💵 1인당 최종 배당금:</span>
                  <strong style="font-size: 12px; font-weight: 900; color: #059669;">+${perShare} D</strong>
                </div>

                <div style="background: rgba(0, 0, 0, 0.03); border: 1px solid var(--drawer-card-border); border-radius: 6px; padding: 5px 8px; max-height: 75px; overflow-y: auto;">
                  <div style="font-size: 10px; font-weight: 700; color: var(--kakao-time-gray); margin-bottom: 2px;">수령자 명단 (${memberCount}명):</div>
                  <div style="font-size: 10.5px; color: var(--kakao-notice-text); line-height: 1.4; word-break: break-all;">
                    ${membersList.map(m => escapeHtmlText(m)).join(', ')}
                  </div>
                </div>
              </div>

              <div class="chat-meta-box">
                <span class="chat-unread-count">${unreadCount}</span>
                <span class="chat-timestamp">${reportTime}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }
  }
  else if (msg.msg_type === "raid_report") {
    let raidData = null;
    try {
      raidData = typeof msg.message === "object" ? msg.message : JSON.parse(msg.message);
    } catch (e) {
      raidData = null;
    }

    if (!raidData) {
      html = `
        <div class="chat-item-row other" id="${msgKey}">
          <div class="chat-sender-avatar bot">⚔️</div>
          <div class="chat-msg-body">
            <div class="chat-sender-name">토벌알리미</div>
            <div class="chat-bubble-flex">
              <div class="chat-bubble">${formatMessageWithMentions(cleanMessageText)}</div>
              <div class="chat-meta-box">
                <span class="chat-unread-count">${unreadCount}</span>
                <span class="chat-timestamp">${timeStr}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      const raidId = raidData.raid_id || msg.id;
      const bossName = raidData.boss_name || "보스";
      const raidTimeDisplay = raidData.raid_time || timeStr;
      const warType = raidData.war_type || "일반";
      const score = raidData.score || 1;
      const members = Array.isArray(raidData.members) ? raidData.members : [];
      const memberCount = members.length;
      const dropItems = (raidData.drop_items || "").trim();
      const createdAtIso = msg.created_at || new Date().toISOString();

      const diffSec = Math.floor((Date.now() - new Date(createdAtIso).getTime()) / 1000);
      const remainingSec = 180 - diffSec;
      const isExpired = remainingSec <= 0;

      const activeNick = localStorage.getItem("guild_my_nickname") || myCurrentNick || "";
      const currentAdminRole = sessionStorage.getItem("admin_role") || "";
      const isSuperAdminAccount = (activeNick === "슈퍼관리자" || activeNick.toLowerCase() === "admin" || currentAdminRole === "super");
      const isAlreadyJoined = !isSuperAdminAccount && members.includes(activeNick);

      let btnDisabledAttr = "";
      let btnClassState = "";
      let btnIconClass = "fa-user-plus";
      let btnTextLabel = "추가참여";

      if (isSuperAdminAccount) {
        btnDisabledAttr = "disabled";
        btnClassState = "disabled";
        btnIconClass = "fa-user-shield";
        btnTextLabel = "관리자";
      } else if (isAlreadyJoined) {
        btnDisabledAttr = "disabled";
        btnClassState = "joined";
        btnIconClass = "fa-check";
        btnTextLabel = "참여완료";
      } else if (isExpired) {
        btnDisabledAttr = "disabled";
        btnClassState = "disabled";
        btnIconClass = "fa-user-plus";
        btnTextLabel = "마감됨";
      }

      let initialTimerText = "03:00";
      if (isExpired) {
        initialTimerText = "마감";
      } else {
        const m = String(Math.floor(remainingSec / 60)).padStart(2, '0');
        const s = String(remainingSec % 60).padStart(2, '0');
        initialTimerText = `${m}:${s}`;
      }

      let warBadgeClass = "badge-war-normal";
      if (warType === "내전") warBadgeClass = "badge-war-internal";
      else if (warType === "인터") warBadgeClass = "badge-war-inter";

      let dropItemsHtml = "";
      if (dropItems) {
        dropItemsHtml = `
          <div class="raid-card-item-row">
            <span class="raid-row-label"><i class="fa-solid fa-gift text-warning me-1"></i>획득 아이템:</span>
            <span class="raid-item-val">${escapeHtmlText(dropItems)}</span>
          </div>
        `;
      }

      html = `
        <div class="chat-item-row other" id="${msgKey}">
          <div class="chat-sender-avatar bot">⚔️</div>
          <div class="chat-msg-body raid-msg-body">
            <div class="chat-sender-name">토벌알리미</div>
            <div class="chat-bubble-flex">
              <div class="raid-report-card" id="raidCard_${raidId}">
                <div class="raid-card-header">
                  <div class="d-flex align-items-center justify-content-between gap-2">
                    <div class="raid-boss-title">
                      <i class="fa-solid fa-shield-halved text-warning me-1"></i>
                      <span>[${escapeHtmlText(bossName)}] 토벌 보고</span>
                    </div>
                    <span class="badge ${warBadgeClass}">${escapeHtmlText(warType)} (+${score}점)</span>
                  </div>
                  <div class="raid-time-sub">
                    <i class="fa-regular fa-clock me-1"></i>${escapeHtmlText(raidTimeDisplay)}
                  </div>
                </div>

                <div class="raid-card-content">
                  ${dropItemsHtml}
                  
                  <div class="raid-members-box">
                    <div class="raid-members-header">
                      <span><i class="fa-solid fa-users me-1 text-primary"></i>참여자 (<span id="raid_mcount_${raidId}">${memberCount}</span>명)</span>
                    </div>
                    <div class="raid-members-tags" id="raid_mlist_${raidId}">
                      ${members.map(m => `<span class="raid-member-pill">${escapeHtmlText(m)}</span>`).join('')}
                    </div>
                  </div>

                  <div class="raid-action-row">
                    <button type="button" 
                            id="btnRaidAdd_${raidId}" 
                            class="btn-raid-self-add ${btnClassState}" 
                            ${btnDisabledAttr} 
                            onclick="handleQuickRaidSelfAdd('${raidId}', '${escapeHtmlText(bossName)}')">
                      <i class="fa-solid ${btnIconClass} me-1"></i>
                      <span class="btn-text">${btnTextLabel}</span>
                    </button>

                    <div class="badge-raid-timer ${isExpired ? 'expired' : 'active'}" 
                         id="timer_raid_${raidId}" 
                         data-raid-id="${raidId}" 
                         data-created-at="${createdAtIso}">
                          <i class="fa-regular fa-clock me-1"></i>
                          <span class="time-text">${initialTimerText}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="chat-meta-box">
                <span class="chat-unread-count">${unreadCount}</span>
                <span class="chat-timestamp">${timeStr}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }
  }
  else if (msg.msg_type === "boss_alert") {
    let cardTypeClass = "alert-3m";
    let isSpawnMsg = false;

    if (cleanMessageText.includes("7분 전")) cardTypeClass = "alert-7m";
    else if (cleanMessageText.includes("컷 완료")) cardTypeClass = "alert-cut";
    else if (cleanMessageText.includes("젠 완료") || cleanMessageText.includes("출현")) {
      cardTypeClass = "alert-spawn";
      isSpawnMsg = true;
    }

    const spawnedBossName = extractBossNameFromMessage(cleanMessageText);

    let subCutButtonHtml = "";
    if (isSpawnMsg && spawnedBossName) {
      const btnId = `btnSubCut_${msg.id || Math.floor(Math.random()*100000)}`;

      const boss = cachedBossList.find(b => b.boss_name.toLowerCase() === spawnedBossName.toLowerCase());
      let isAlreadyCut = false;
      if (boss && boss.next_spawn_time) {
        const diffSec = Math.floor((new Date(boss.next_spawn_time).getTime() - Date.now()) / 1000);
        if (diffSec > 0) isAlreadyCut = true;
      }

      subCutButtonHtml = `
        <div class="spawn-msg-action-row">
          <button type="button" id="${btnId}" data-boss-name="${escapeHtmlText(spawnedBossName)}" class="btn-msg-sub-cut ${isAlreadyCut ? 'disabled' : ''}" 
                  ${isAlreadyCut ? 'disabled' : ''} 
                  onclick="triggerQuickCutAction('${escapeHtmlText(spawnedBossName)}', '${btnId}')">
            <i class="fa-solid fa-${isAlreadyCut ? 'check' : 'skull'}"></i> ${isAlreadyCut ? '완료' : '컷 처리'}
          </button>
        </div>
      `;
    }

    html = `
      <div class="chat-item-row other" id="${msgKey}">
        <div class="chat-sender-avatar bot">📢</div>
        <div class="chat-msg-body">
          <div class="chat-sender-name">${escapeHtmlText(msg.sender_name)}</div>
          <div class="chat-bubble-flex">
            <div class="spawn-card-wrapper">
              <div class="boss-alert-mini-card ${cardTypeClass}">
                ${cleanMessageText}
              </div>
              ${subCutButtonHtml}
            </div>
            <div class="chat-meta-box">
              <span class="chat-unread-count">${unreadCount}</span>
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
          <div class="chat-bubble-flex">
            <div class="chat-bubble ${isMentioned ? 'border border-warning' : ''}">${formatMessageWithMentions(cleanMessageText)}</div>
            <div class="chat-meta-box">
              <span class="chat-unread-count">1</span>
              <span class="chat-timestamp">${timeStr}</span>
            </div>
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
          <div class="chat-bubble-flex">
            <div class="chat-bubble ${isMentioned ? 'border border-warning' : ''}">${formatMessageWithMentions(cleanMessageText)}</div>
            <div class="chat-meta-box">
              <span class="chat-unread-count">${unreadCount}</span>
              <span class="chat-timestamp">${timeStr}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  container.insertAdjacentHTML('beforeend', html);

  while (container.children.length > 120) {
    container.removeChild(container.firstChild);
  }

  scrollChatBottom();

  if (isRealtime && !isMe) {
    triggerBeepSound(isMentioned || msg.msg_type === "boss_alert");
  }
}

function formatMessageWithMentions(text) {
  let safeText = escapeHtmlText(text);
  cachedMemberList.forEach(m => {
    const name = m.name;
    const mentionTarget = `@${name}`;
    if (safeText.includes(mentionTarget)) {
      safeText = safeText.replaceAll(mentionTarget, `<span class="badge bg-light text-primary" style="font-size:0.75rem;">@${name}</span>`);
    }
  });
  return safeText.replace(/\n/g, '<br>');
}

function handleInputState(textarea) {
  const btn = document.getElementById("btnKakaoSend");
  if (textarea.value.trim().length > 0) {
    btn.classList.add("active");
  } else {
    btn.classList.remove("active");
  }
}

function checkEnterKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSendMessage();
  }
}

function parseCustomTimeString(timeStr) {
  if (!timeStr) return null;
  let clean = timeStr.replace(/[^0-9]/g, '');
  if (clean.length === 3) clean = '0' + clean;
  if (clean.length !== 4) return null;

  const hour = parseInt(clean.slice(0, 2), 10);
  const min = parseInt(clean.slice(2, 4), 10);
  if (hour < 0 || hour > 23 || min < 0 || min > 59) return null;

  const target = new Date();
  target.setHours(hour, min, 0, 0);
  return target;
}

window.postBossBriefingToChat = async function() {
  if (cachedBossList.length === 0) {
    await loadBossTimersList();
  }
  if (cachedBossList.length === 0) {
    return showKakaoToast("등록된 보스 타이머가 없습니다.", "⚠️");
  }

  const now = Date.now();
  const sorted = [...cachedBossList].sort((a,b) => {
    const tA = a.next_spawn_time ? new Date(a.next_spawn_time).getTime() : 9999999999999;
    const tB = b.next_spawn_time ? new Date(b.next_spawn_time).getTime() : 9999999999999;
    return tA - tB;
  });

  const currentKstFormatted = formatTime24Hour(new Date());
  let briefingHtml = `<div class="boss-brief-title"><span>[보스 리젠 현황]</span><span style="font-size:0.62rem; color:#64748b;">${currentKstFormatted}</span></div>`;

  sorted.forEach((b) => {
    if (!b.next_spawn_time) {
      briefingHtml += `<div class="boss-brief-line"><span>• ${escapeHtmlText(b.boss_name)}: 컷 대기</span><span style="font-size:0.68rem; color:#64748b;">대기</span></div>`;
      return;
    }

    const nextDate = new Date(b.next_spawn_time);
    const diffSec = Math.floor((nextDate.getTime() - now) / 1000);
    const timeDisplay = formatTime24Hour(nextDate);

    if (diffSec <= 0) {
      const passM = Math.floor(Math.abs(diffSec) / 60);
      briefingHtml += `<div class="boss-brief-line spawned"><span>• 🚨 ${escapeHtmlText(b.boss_name)}: 젠 됨!</span><span>(+${passM}분)</span></div>`;
    } else {
      const h = Math.floor(diffSec / 3600);
      const m = Math.floor((diffSec % 3600) / 60);
      const remainText = `${h > 0 ? h + '시간 ' : ''}${m}분`;
      briefingHtml += `<div class="boss-brief-line"><span>• ${escapeHtmlText(b.boss_name)}: ${timeDisplay}</span><span style="font-size:0.68rem; color:#0284c7; font-weight:700;">(${remainText})</span></div>`;
    }
  });

  try {
    await apiRequest("guild_chats", "POST", [{
      sender_name: "보스알리미",
      message: briefingHtml,
      msg_type: "boss_briefing",
      mentions: []
    }]);
    showKakaoToast("보스타임이 브리핑되었습니다!", "⏰");
  } catch (err) {
    showKakaoToast("브리핑 전송 실패: " + err.message, "❌");
  }
};

window.triggerQuickCutAction = async function(bossName, btnId) {
  const btn = document.getElementById(btnId);
  
  const boss = cachedBossList.find(b => b.boss_name.toLowerCase() === bossName.toLowerCase());
  if (!boss) {
    return showKakaoToast("보스 정보를 찾을 수 없습니다.", "❌");
  }

  if (boss.next_spawn_time) {
    const diffSec = Math.floor((new Date(boss.next_spawn_time).getTime() - Date.now()) / 1000);
    if (diffSec > 0) {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-check"></i> 완료`;
        btn.classList.add("disabled");
      }
      return showKakaoToast(`[${bossName}] 이미 컷 완료된 보스입니다!`, "⚠️");
    }
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> 완료`;
    btn.classList.add("disabled");
  }

  const cutDate = new Date();
  const nextSpawn = new Date(cutDate.getTime() + (boss.cycle_min * 60 * 1000));

  try {
    await apiRequest(`boss_timers?id=eq.${boss.id}`, "PATCH", {
      last_cut_time: cutDate.toISOString(),
      next_spawn_time: nextSpawn.toISOString()
    });

    const alertMessage = `[${escapeHtmlText(boss.boss_name)}] 컷 완료!<br>• 컷 시각: ${formatTime24Hour(cutDate)}<br>• 다음 젠: ${formatTime24HourWithDate(nextSpawn)}`;

    await apiRequest("guild_chats", "POST", [{
      sender_name: "보스알리미",
      message: alertMessage,
      msg_type: "boss_alert",
      mentions: []
    }]);
    showKakaoToast(`[${boss.boss_name}] 컷 완료!`, "🎉");
    syncAllChatCutButtons();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-skull"></i> 컷 처리`; btn.classList.remove("disabled"); }
    showKakaoToast("컷 처리 실패: " + err.message, "❌");
  }
};

async function handleBossChatCommands(rawText) {
  const trimmed = rawText.trim();

  if (trimmed === '!보스') {
    postBossBriefingToChat();
    return true;
  }

  if (trimmed.startsWith('!컷')) {
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
      showKakaoToast("!컷 [보스명] [시간] 형식으로 입력하세요", "⚠️");
      return true;
    }

    const bossName = parts[1];
    const timeInput = parts[2];

    const boss = cachedBossList.find(b => b.boss_name.toLowerCase() === bossName.toLowerCase());
    if (!boss) {
      showKakaoToast(`[${bossName}] 보스를 찾을 수 없습니다.`, "❌");
      return true;
    }

    let cutDate = new Date();
    if (timeInput) {
      const parsed = parseCustomTimeString(timeInput);
      if (!parsed) {
        showKakaoToast("시간 형식이 올바르지 않습니다 (예: 1100, 2000)", "⚠️");
        return true;
      }
      cutDate = parsed;
    }

    const nextSpawn = new Date(cutDate.getTime() + (boss.cycle_min * 60 * 1000));
    await apiRequest(`boss_timers?id=eq.${boss.id}`, "PATCH", {
      last_cut_time: cutDate.toISOString(),
      next_spawn_time: nextSpawn.toISOString()
    });

    const alertMessage = `[${escapeHtmlText(boss.boss_name)}] 컷 완료!<br>• 컷 시각: ${formatTime24Hour(cutDate)}<br>• 다음 젠: ${formatTime24HourWithDate(nextSpawn)}`;

    await apiRequest("guild_chats", "POST", [{
      sender_name: "보스알리미",
      message: alertMessage,
      msg_type: "boss_alert",
      mentions: []
    }]);
    syncAllChatCutButtons();
    return true;
  }

  if (trimmed.startsWith('!예약')) {
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) {
      showKakaoToast("!예약 [보스명] [시간] 형식으로 입력하세요", "⚠️");
      return true;
    }

    const bossName = parts[1];
    const timeInput = parts[2];

    const boss = cachedBossList.find(b => b.boss_name.toLowerCase() === bossName.toLowerCase());
    if (!boss) {
      showKakaoToast(`[${bossName}] 보스를 찾을 수 없습니다.`, "❌");
      return true;
    }

    const spawnDate = parseCustomTimeString(timeInput);
    if (!spawnDate) {
      showKakaoToast("시간 형식이 올바르지 않습니다 (예: 2200)", "⚠️");
      return true;
    }

    await apiRequest(`boss_timers?id=eq.${boss.id}`, "PATCH", {
      next_spawn_time: spawnDate.toISOString()
    });

    const spawnTimeStr = formatTime24HourWithDate(spawnDate);
    await apiRequest("guild_chats", "POST", [{
      sender_name: "보스알리미",
      message: `[${escapeHtmlText(boss.boss_name)}] 젠 예약 완료!<br>• 예정 시각: ${spawnTimeStr}`,
      msg_type: "boss_alert",
      mentions: []
    }]);
    syncAllChatCutButtons();
    return true;
  }

  return false;
}

async function handleSendMessage() {
  const textarea = document.getElementById("inputChatMessage");
  const text = textarea.value.trim();
  if (!text) return;

  if (!myCurrentNick || !myCurrentPin) {
    showKakaoToast("로그인이 필요합니다.", "⚠️");
    showGuildLoginModal();
    return;
  }

  textarea.value = "";
  handleInputState(textarea);
  closeMentionPopup();

  const isCommand = (text.startsWith('!') || text.startsWith('！'));

  const detectedMentions = [];
  cachedMemberList.forEach(m => {
    if (text.includes(`@${m.name}`)) detectedMentions.push(m.name);
  });

  const tempId = "opt_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
  const optimisticMsg = {
    id: tempId,
    sender_name: myCurrentNick,
    message: text,
    msg_type: "chat",
    mentions: detectedMentions,
    created_at: new Date().toISOString()
  };

  pendingOptimisticMessages.push({
    tempId: tempId,
    text: text,
    time: Date.now()
  });
  if (pendingOptimisticMessages.length > 40) {
    pendingOptimisticMessages = pendingOptimisticMessages.filter(p => Date.now() - p.time < 15000);
  }

  const isConsecutive = (myCurrentNick === lastRenderedSender);
  renderKakaoChatBubble(optimisticMsg, false, isConsecutive);
  lastRenderedSender = myCurrentNick;

  (async () => {
    try {
      const insertRes = await apiRequest("guild_chats", "POST", [{
        sender_name: myCurrentNick,
        message: text,
        msg_type: "chat",
        mentions: detectedMentions
      }]);

      if (insertRes && insertRes[0] && insertRes[0].id) {
        const rowElem = document.getElementById("msg_" + tempId);
        if (rowElem) {
          rowElem.id = "msg_" + insertRes[0].id;
          rowElem.setAttribute("data-msg-id", insertRes[0].id);
        }
      }
    } catch (err) {
      showKakaoToast("전송 실패: " + err.message, "❌");
      const rowElem = document.getElementById("msg_" + tempId);
      if (rowElem) {
        const bubble = rowElem.querySelector(".chat-bubble");
        if (bubble) bubble.classList.add("border", "border-danger");
      }
      return;
    }

    if (isCommand) {
      await handleBossChatCommands(text);
    }
  })();
}

function bindMentionInputEvents() {
  const textarea = document.getElementById("inputChatMessage");
  const popup = document.getElementById("mentionPopupBox");

  textarea.addEventListener("input", () => {
    const val = textarea.value;
    const lastAt = val.lastIndexOf("@");
    if (lastAt !== -1) {
      const q = val.slice(lastAt + 1).toLowerCase();
      const matched = cachedMemberList.filter(m => m.name.toLowerCase().includes(q));
      if (matched.length > 0) {
        popup.innerHTML = matched.slice(0, 5).map(m => `
          <div class="mention-item-row" onclick="applyMentionNick('${m.name}')">
            <i class="fa-solid fa-at text-primary"></i> ${m.name}
          </div>
        `).join('');
        popup.style.display = "block";
        return;
      }
    }
    popup.style.display = "none";
  });
}

function applyMentionNick(name) {
  const textarea = document.getElementById("inputChatMessage");
  const val = textarea.value;
  const lastAt = val.lastIndexOf("@");
  textarea.value = val.slice(0, lastAt) + `@${name} `;
  closeMentionPopup();
  textarea.focus();
  handleInputState(textarea);
}

function closeMentionPopup() {
  document.getElementById("mentionPopupBox").style.display = "none";
}

window.openModulePage = async function(pageName) {
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
    "PageEnemies": "원수목록",
    "PageSettings": "시스템 설정"
  };

  navTitle.innerText = titleMap[pageName] || "기능 화면";
  if (typeof window.applyAppTheme === "function") window.applyAppTheme();
  overlay.style.display = "flex";
  body.innerHTML = `<div class="text-secondary small text-center py-5"><i class="fa-solid fa-spinner fa-spin me-2"></i>화면을 불러오는 중...</div>`;

  try {
    let res = await fetch(`pages/${pageName}.html?_t=${Date.now()}`);
    if (!res.ok) {
      res = await fetch(`pages/${pageName}.htm?_t=${Date.now()}`);
    }
    if (!res.ok) throw new Error("로드 실패");
    const html = await res.text();
    body.innerHTML = html;

    document.querySelectorAll(".module-dynamic-script").forEach(s => s.remove());
    body.querySelectorAll("script").forEach(s => {
      const sc = document.createElement("script");
      sc.className = "drawer-member-script";
      if (s.src) sc.src = s.src; else sc.textContent = s.textContent;
      document.body.appendChild(sc);
    });
  } catch (e) {
    body.innerHTML = `<div class="text-danger small text-center py-5">화면 로드 실패: ${e.message}</div>`;
  }
};

window.closeModuleOverlay = function() {
  document.getElementById("moduleOverlay").style.display = "none";
  document.getElementById("overlayBodyContent").innerHTML = "";
  document.querySelectorAll(".module-dynamic-script").forEach(s => s.remove());
  if (typeof window.applyAppTheme === "function") window.applyAppTheme();
};

var raidCountdownInterval = null;

function startRaidReportCountdowns() {
  if (raidCountdownInterval) clearInterval(raidCountdownInterval);

  raidCountdownInterval = setInterval(() => {
    const timerBadges = document.querySelectorAll(".badge-raid-timer");
    const now = Date.now();

    timerBadges.forEach(badge => {
      const createdAtStr = badge.getAttribute("data-created-at");
      const raidId = badge.getAttribute("data-raid-id");
      if (!createdAtStr) return;

      let createdTime = new Date(createdAtStr).getTime();
      if (isNaN(createdTime)) return;

      const diffSec = Math.floor((now - createdTime) / 1000);
      const remainingSec = 180 - diffSec;

      const timeTextElem = badge.querySelector(".time-text") || badge;
      const btn = document.getElementById(`btnRaidAdd_${raidId}`);

      if (remainingSec > 0) {
        const m = String(Math.floor(remainingSec / 60)).padStart(2, '0');
        const s = String(remainingSec % 60).padStart(2, '0');
        timeTextElem.innerText = `${m}:${s}`;
        badge.classList.remove("expired");
        badge.classList.add("active");
      } else {
        timeTextElem.innerText = "마감";
        badge.classList.remove("active");
        badge.classList.add("expired");
        if (btn && !btn.classList.contains("joined")) {
          btn.disabled = true;
          btn.classList.add("disabled");
          const btnSpan = btn.querySelector(".btn-text");
          if (btnSpan && btnSpan.innerText !== "관리자") btnSpan.innerText = "마감됨";
        }
      }
    });
  }, 1000);
}

window.handleQuickRaidSelfAdd = async function(raidId, bossName) {
  const myNick = localStorage.getItem("guild_my_nickname") || myCurrentNick || "";
  if (!myNick) {
    showKakaoToast("로그인이 필요합니다.", "⚠️");
    showGuildLoginModal();
    return;
  }

  const currentRole = sessionStorage.getItem("admin_role") || "";
  if (myNick === "슈퍼관리자" || myNick.toLowerCase() === "admin" || currentRole === "super") {
    return showKakaoToast("슈퍼관리자는 시스템 관리 계정이므로 토벌에 참여할 수 없습니다.", "⚠️");
  }

  if (Array.isArray(cachedMemberList) && cachedMemberList.length > 0) {
    const isMember = cachedMemberList.some(m => m.name.toLowerCase() === myNick.toLowerCase());
    if (!isMember) {
      return showKakaoToast("길드원 명단에 등록된 캐릭터만 토벌에 참여할 수 있습니다.", "⚠️");
    }
  }

  const btn = document.getElementById(`btnRaidAdd_${raidId}`);
  const timerBadge = document.getElementById(`timer_raid_${raidId}`);

  if (timerBadge && timerBadge.classList.contains("expired")) {
    return showKakaoToast("참여 가능 시간(3분)이 이미 마감되었습니다.", "⚠️");
  }

  if (btn) {
    btn.disabled = true;
    const btnSpan = btn.querySelector(".btn-text");
    if (btnSpan) btnSpan.innerText = "참여 중...";
  }

  try {
    const records = await apiRequest(`boss_participations?id=eq.${raidId}&select=*`);
    if (!records || records.length === 0) {
      if (btn) btn.disabled = false;
      return showKakaoToast("토벌 기록을 찾을 수 없습니다.", "❌");
    }

    const raid = records[0];
    const createdAt = new Date(raid.created_at).getTime();

    if (Date.now() - createdAt > 180 * 1000) {
      if (btn) {
        btn.disabled = true;
        btn.classList.add("disabled");
        const btnSpan = btn.querySelector(".btn-text");
        if (btnSpan) btnSpan.innerText = "마감됨";
      }
      if (timerBadge) {
        timerBadge.classList.remove("active");
        timerBadge.classList.add("expired");
        const timeText = timerBadge.querySelector(".time-text");
        if (timeText) timeText.innerText = "마감";
      }
      return showKakaoToast("참여 가능 시간(3분)이 종료되었습니다.", "⚠️");
    }

    let members = Array.isArray(raid.members) ? raid.members : [];
    if (members.includes(myNick)) {
      if (btn) {
        btn.disabled = true;
        btn.classList.add("joined");
        btn.innerHTML = `<i class="fa-solid fa-check me-1"></i><span class="btn-text">참여완료</span>`;
      }
      return showKakaoToast("이미 참여 명단에 등록되어 있습니다!", "ℹ️");
    }

    members.push(myNick);
    const newCount = members.length;

    await apiRequest(`boss_participations?id=eq.${raidId}`, "PATCH", {
      members: members,
      member_count: newCount
    });

    const countElem = document.getElementById(`raid_mcount_${raidId}`);
    if (countElem) countElem.innerText = newCount;

    const listElem = document.getElementById(`raid_mlist_${raidId}`);
    if (listElem) {
      const newPill = document.createElement("span");
      newPill.className = "raid-member-pill new-joined";
      newPill.innerText = myNick;
      listElem.appendChild(newPill);
    }

    if (btn) {
      btn.disabled = true;
      btn.classList.add("joined");
      btn.innerHTML = `<i class="fa-solid fa-check me-1"></i><span class="btn-text">참여완료</span>`;
    }

    await apiRequest("guild_chats", "POST", [{
      sender_name: "토벌알리미",
      message: `🎉 [${myNick}] 님이 [${bossName}] 토벌에 추가 참여하였습니다! (현재 총 ${newCount}명)`,
      msg_type: "chat",
      mentions: []
    }]);

    showKakaoToast(`[${bossName}] 토벌에 추가 참여 완료!`, "🎉");
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      const btnSpan = btn.querySelector(".btn-text");
      if (btnSpan) btnSpan.innerText = "추가참여";
    }
    showKakaoToast("참여 실패: " + err.message, "❌");
  }
};

function listenRealtimeBossParticipations() {
  if (!supabaseClient) return;

  supabaseClient
    .channel("public:boss_participations")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "boss_participations" }, (payload) => {
      const updated = payload.new;
      if (!updated) return;

      const countElem = document.getElementById(`raid_mcount_${updated.id}`);
      if (countElem) countElem.innerText = updated.member_count;

      const listElem = document.getElementById(`raid_mlist_${updated.id}`);
      if (listElem && Array.isArray(updated.members)) {
        listElem.innerHTML = updated.members.map(m => `<span class="raid-member-pill">${escapeHtmlText(m)}</span>`).join('');
      }

      if (Array.isArray(updated.members) && updated.members.includes(myCurrentNick)) {
        const btn = document.getElementById(`btnRaidAdd_${updated.id}`);
        if (btn) {
          btn.disabled = true;
          btn.classList.add("joined");
          btn.innerHTML = `<i class="fa-solid fa-check me-1"></i><span class="btn-text">참여완료</span>`;
        }
      }
    })
    .subscribe();
}

function startLocalBossWatchTimer() {
  if (bossWatcherInterval) clearInterval(bossWatcherInterval);

  bossWatcherInterval = setInterval(async () => {
    const now = Date.now();

    for (const b of (cachedBossList || [])) {
      if (!b.next_spawn_time) continue;
      const diffSec = Math.floor((new Date(b.next_spawn_time).getTime() - now) / 1000);

      const key7Min = `${b.id}_7m_${b.next_spawn_time}`;
      if (diffSec <= 420 && diffSec > 360 && !notifiedBossSpawnMap.has(key7Min)) {
        saveNotifiedBossKey(key7Min);
        await sendBossAlertBroadcast(`⏳ [${b.boss_name}] 젠 7분 전입니다! 출동 준비하세요!`, key7Min);
      }

      const key3Min = `${b.id}_3m_${b.next_spawn_time}`;
      if (diffSec <= 180 && diffSec > 120 && !notifiedBossSpawnMap.has(key3Min)) {
        saveNotifiedBossKey(key3Min);
        await sendBossAlertBroadcast(`🚨 [${b.boss_name}] 젠 3분 전 임박! 보스 위치로 집결하세요!`, key3Min);
      }

      const keySpawned = `${b.id}_spawn_${b.next_spawn_time}`;
      if (diffSec <= 0 && diffSec > -600 && !notifiedBossSpawnMap.has(keySpawned)) {
        saveNotifiedBossKey(keySpawned);
        await sendBossAlertBroadcast(`🔥 [${b.boss_name}] 젠 완료! 출현했습니다! 즉시 처치 바랍니다!`, keySpawned);
      }
    }
  }, 1000);
}

async function sendBossAlertBroadcast(msgText, uniqueKey = "") {
  try {
    const match = msgText.match(/\[([^\]]+)\]/);
    const bossName = match ? match[1] : "";
    const alertType = msgText.includes("젠 완료") ? "젠 완료" : (msgText.includes("7분 전") ? "7분 전" : "3분 전");

    if (bossName) {
      const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const checkRes = await apiRequest(`guild_chats?sender_name=eq.보스알리미&created_at=gte.${threeMinAgo}&message=like.*[${encodeURIComponent(bossName)}]*${encodeURIComponent(alertType)}*&limit=1`);
      if (checkRes && checkRes.length > 0) {
        if (uniqueKey) saveNotifiedBossKey(uniqueKey);
        return;
      }
    }

    await apiRequest("guild_chats", "POST", [{
      sender_name: "보스알리미",
      message: msgText.trim(),
      msg_type: "boss_alert",
      mentions: []
    }]);

    if (uniqueKey) saveNotifiedBossKey(uniqueKey);
  } catch (e) {}
}

function setupPwaInstallation() {
  const installBtn = document.getElementById("btnPwaInstall");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.style.display = "inline-flex";
  });

  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        installBtn.style.display = "none";
      }
      deferredPrompt = null;
    });
  }
}

function scrollChatBottom() {
  const box = document.getElementById("chatMessagesView");
  box.scrollTop = box.scrollHeight;
}
function escapeHtmlText(t) {
  return (t || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
}
function focusChatInput() {
  document.getElementById("inputChatMessage").focus();
}
function triggerBeepSound(isImportant = false) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = isImportant ? 880 : 587;
    gain.gain.value = 0.08;
    osc.start();
    setTimeout(() => osc.stop(), 150);
  } catch (e) {}
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch(err => console.warn('PWA 등록 실패:', err));
  });
}

window.addEventListener("DOMContentLoaded", initApp);
