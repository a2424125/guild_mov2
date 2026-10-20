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
  const iconSpan = document.getElementById("kakaoToastIcon");
  const msgSpan = document.getElementById("kakaoToastMsg");

  if (!box) return;

  if (kakaoToastTimer) clearTimeout(kakaoToastTimer);

  iconSpan.innerText = icon;
  msgSpan.innerText = msg;
  box.classList.add("show");

  kakaoToastTimer = setTimeout(() => {
    box.classList.remove("show");
  }, 2300);
}

function toggleThemeMode() {
  const isLight = document.documentElement.classList.contains("theme-light");
  if (isLight) {
    document.documentElement.classList.remove("theme-light");
    document.documentElement.classList.add("theme-dark");
    document.body.classList.remove("theme-light");
    document.body.classList.add("theme-dark");
    localStorage.setItem("guild_theme_mode", "dark");
    showKakaoToast("다크 모드로 전환되었습니다.", "🌙");
  } else {
    document.documentElement.classList.remove("theme-dark");
    document.documentElement.classList.add("theme-light");
    document.body.classList.remove("theme-dark");
    document.body.classList.add("theme-light");
    localStorage.setItem("guild_theme_mode", "light");
    showKakaoToast("라이트 모드로 전환되었습니다.", "☀️");
  }
}

window.applyAppTheme = function() {
  const theme = localStorage.getItem("guild_theme_mode") || "dark";
  if (theme === "light") {
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
};

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById("btnPwaInstall");
  if (btn) {
    btn.style.display = "inline-flex";
    btn.onclick = async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          showKakaoToast("앱 설치를 시작합니다.", "📱");
        }
        deferredPrompt = null;
        btn.style.display = "none";
      }
    };
  }
});

async function initApp() {
  window.applyAppTheme();

  if (typeof supabase !== "undefined" && typeof SUPABASE_CONFIG !== "undefined") {
    supabaseClient = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
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
        if ((item.key === "super_admin_pw" || item.key === "super_admin_pin") && item.value) {
          window.masterAdminPin = item.value;
        }
      });
    }
  } catch (e) {}
}

async function loadTopNoticeHeader() {
  try {
    const res = await apiRequest("guild_notices?select=title,content,is_pinned&order=id.desc&limit=5");
    if (res && res.length > 0) {
      const pinned = res.find(n => n.is_pinned === true || n.is_pinned === 'true') || res[0];
      const title = (pinned.title || "").replace(/^\[[^\]]+\]\s*/, '');
      document.getElementById("kakaoTopNoticeText").innerText = title ? `[공지] ${title}` : "공지사항이 등록되었습니다.";
    } else {
      document.getElementById("kakaoTopNoticeText").innerText = "등록된 공지사항이 없습니다.";
    }
  } catch (e) {}
}

async function loadGuildMembersData() {
  try {
    const res = await apiRequest("guild_members?select=id,name,role,job_class,pin&order=role.asc,name.asc");
    if (res) {
      cachedMemberList = res;
      document.getElementById("roomMemberCountText").innerText = cachedMemberList.length;
      renderDrawerMembersList();
    }
  } catch (e) {}
}

function renderDrawerMembersList() {
  const container = document.getElementById("drawerMembersContainer");
  if (!container) return;

  const rolesOrder = { "길드장": 1, "길마": 1, "부길드장": 2, "부길마": 2, "정예": 3, "일반": 4 };

  const sorted = [...cachedMemberList].sort((a, b) => {
    const rA = rolesOrder[a.role] || 99;
    const rB = rolesOrder[b.role] || 99;
    if (rA !== rB) return rA - rB;
    return (a.name || "").localeCompare(b.name || "", 'ko');
  });

  const html = `
    <div style="padding: 14px; border-bottom: 1px solid var(--drawer-header-border); background: var(--drawer-header-bg); display: flex; justify-content: space-between; align-items: center;">
      <div style="font-weight: 800; font-size: 0.92rem; color: var(--drawer-title);"><i class="fa-solid fa-users text-primary me-2"></i>길드원 목록 (${sorted.length}명)</div>
      <button type="button" class="sidebar-close-btn" onclick="toggleMembersDrawer(false)"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div style="flex: 1; overflow-y: auto; padding: 8px 6px;">
      ${sorted.map(m => {
        const isMaster = (m.role === "길드장" || m.role === "길마");
        const isSubMaster = (m.role === "부길드장" || m.role === "부길마");
        const isElite = (m.role === "정예");

        let roleBadge = '<span class="badge bg-secondary bg-opacity-25 text-secondary" style="font-size:0.65rem;">일반</span>';
        if (isMaster) roleBadge = '<span class="badge bg-warning bg-opacity-25 text-warning" style="font-size:0.65rem;">길드장</span>';
        else if (isSubMaster) roleBadge = '<span class="badge bg-primary bg-opacity-25 text-primary" style="font-size:0.65rem;">부길드장</span>';
        else if (isElite) roleBadge = '<span class="badge bg-info bg-opacity-25 text-info" style="font-size:0.65rem;">정예</span>';

        const avatar = (m.job_class || "👤").split(' ')[0] || "👤";
        const jobName = (m.job_class || "미설정").replace(/^[^\s]+\s*/, '') || "미설정";

        return `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-radius: 8px; margin-bottom: 3px; background: var(--drawer-card-bg); border: 1px solid var(--drawer-card-border);">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
              <div style="width: 30px; height: 30px; border-radius: 10px; background: rgba(0,0,0,0.05); display: flex; align-items: center; justify-content: center; font-size: 1rem;">${avatar}</div>
              <div style="min-width: 0;">
                <div style="font-weight: 700; font-size: 0.82rem; color: var(--drawer-title); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtmlText(m.name)}</div>
                <div style="font-size: 0.68rem; color: var(--drawer-sub-text);">${escapeHtmlText(jobName)}</div>
              </div>
            </div>
            <div>${roleBadge}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
  container.innerHTML = html;
}

async function loadBossTimersList() {
  try {
    const res = await apiRequest("boss_timers?select=*&order=id.asc");
    if (res) {
      cachedBossList = res;
      syncAllChatCutButtons();
    }
  } catch (e) {}
}

function toggleMenuDrawer(open) {
  const drawer = document.getElementById("menuSidebarDrawer");
  const backdrop = document.getElementById("commonDrawerBackdrop");
  if (!drawer || !backdrop) return;
  if (open) {
    closeAllDrawers();
    drawer.classList.add("open");
    backdrop.classList.add("show");
  } else {
    drawer.classList.remove("open");
    checkBackdropState();
  }
}

function toggleMembersDrawer(open) {
  const drawer = document.getElementById("membersSidebarDrawer");
  const backdrop = document.getElementById("commonDrawerBackdrop");
  if (!drawer || !backdrop) return;
  if (open) {
    closeAllDrawers();
    drawer.classList.add("open");
    backdrop.classList.add("show");
  } else {
    drawer.classList.remove("open");
    checkBackdropState();
  }
}

function toggleBossDrawer(open) {
  const drawer = document.getElementById("bossTimerSidebarDrawer");
  const backdrop = document.getElementById("commonDrawerBackdrop");
  if (!drawer || !backdrop) return;
  if (open) {
    closeAllDrawers();
    drawer.classList.add("open");
    backdrop.classList.add("show");
    loadDrawerPageTimer();
  } else {
    drawer.classList.remove("open");
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
  const backdrop = document.getElementById("commonDrawerBackdrop");
  if (!isMenuOpen && !isMembersOpen && !isBossOpen) {
    backdrop.classList.remove("show");
  }
}

function openProfileEditModal() {
  document.getElementById("modalProfileEdit").style.display = "flex";
}

function closeProfileEditModal() {
  document.getElementById("modalProfileEdit").style.display = "none";
}

async function selectClassProfile(icon, jobName) {
  myCurrentAvatar = icon;
  myCurrentClass = `${icon} ${jobName}`;
  localStorage.setItem("guild_my_avatar", myCurrentAvatar);
  localStorage.setItem("guild_my_class", myCurrentClass);

  updateProfileUI(myCurrentNick);

  if (myCurrentNick && myCurrentNick !== "슈퍼관리자" && myCurrentNick.toLowerCase() !== "admin") {
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
  if ((nick === "슈퍼관리자" || nick.toLowerCase() === "admin") && (pin === "123456" || pin === masterPin)) {
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

  if (isSuperId) {
    if (inputPin === "123456" || inputPin === masterPin || (window.masterAdminPin && inputPin === window.masterAdminPin)) {
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
    } else {
      document.getElementById("loginPinInput").value = "";
      document.getElementById("loginPinInput").focus();
      return showKakaoToast("관리자 비밀번호가 올바르지 않습니다! (기본: 123456)", "❌");
    }
  }

  const targetMember = cachedMemberList.find(m => m.name.toLowerCase() === selectedName.toLowerCase());
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

  if (targetMember.job_class) {
    myCurrentClass = targetMember.job_class;
    myCurrentAvatar = targetMember.job_class.split(' ')[0] || "👤";
    localStorage.setItem("guild_my_class", myCurrentClass);
    localStorage.setItem("guild_my_avatar", myCurrentAvatar);
  }

  updateProfileUI(targetMember.name);
  document.getElementById("guildLoginModal").style.display = "none";
  showKakaoToast(`[${targetMember.name}]님 로그인 완료!`, "👋");
}

function handleUserLogout() {
  if (!confirm("정말 로그아웃 하시겠습니까?")) return;
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
  const container = document.getElementById("chatMessagesView");
  if (!container) return;

  try {
    const list = await apiRequest("guild_chats?select=*&order=id.desc&limit=100");
    if (!list) return;

    const ordered = list.reverse();
    renderChatMessagesBatch(ordered);
    scrollChatBottom();
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
          return;
        }
      }

      appendSingleChatMessage(newMsg);
      scrollChatBottom();
    })
    .subscribe();
}

function listenRealtimeBossTimers() {
  if (!supabaseClient) return;

  supabaseClient
    .channel("public:boss_timers")
    .on("postgres_changes", { event: "*", schema: "public", table: "boss_timers" }, async () => {
      await loadBossTimersList();
      const isBossDrawerOpen = document.getElementById("bossTimerSidebarDrawer").classList.contains("open");
      if (isBossDrawerOpen) {
        await loadDrawerPageTimer();
      }
    })
    .subscribe();
}

function listenRealtimeBossParticipations() {
  if (!supabaseClient) return;

  supabaseClient
    .channel("public:boss_participations")
    .on("postgres_changes", { event: "*", schema: "public", table: "boss_participations" }, () => {})
    .subscribe();
}

function startLocalBossWatchTimer() {
  if (bossWatcherInterval) clearInterval(bossWatcherInterval);

  bossWatcherInterval = setInterval(async () => {
    if (!cachedBossList || cachedBossList.length === 0) return;

    const now = Date.now();
    for (let boss of cachedBossList) {
      if (!boss.next_spawn_time) continue;

      const spawnTime = new Date(boss.next_spawn_time).getTime();
      const diffSec = Math.floor((spawnTime - now) / 1000);

      const spawnTimeKey = new Date(boss.next_spawn_time).toISOString().slice(0, 16);
      const key7m = `${boss.id}_7m_${spawnTimeKey}`;
      const key3m = `${boss.id}_3m_${spawnTimeKey}`;
      const keySpawn = `${boss.id}_spawn_${spawnTimeKey}`;

      if (diffSec <= 420 && diffSec > 360 && !notifiedBossSpawnMap.has(key7m)) {
        saveNotifiedBossKey(key7m);
        await sendBossAlertMessage(boss.boss_name, "7분 전", boss.location);
      } else if (diffSec <= 180 && diffSec > 120 && !notifiedBossSpawnMap.has(key3m)) {
        saveNotifiedBossKey(key3m);
        await sendBossAlertMessage(boss.boss_name, "3분 전", boss.location);
      } else if (diffSec <= 0 && diffSec > -120 && !notifiedBossSpawnMap.has(keySpawn)) {
        saveNotifiedBossKey(keySpawn);
        await sendBossAlertMessage(boss.boss_name, "출현", boss.location);
      }
    }
  }, 1000);
}

function startRaidReportCountdowns() {
  setInterval(() => {
    updateActiveRaidTimers();
  }, 1000);
}

function renderChatMessagesBatch(messages) {
  const container = document.getElementById("chatMessagesView");
  if (!container) return;

  let fullHtml = `
    <div class="text-center my-1">
      <span class="badge bg-secondary bg-opacity-25 text-secondary px-2 py-1" style="font-size:0.65rem;">대화가 안전하게 연결되었습니다.</span>
    </div>
  `;

  let prevSender = null;
  messages.forEach(c => {
    const isConsecutive = (c.sender_name === prevSender && c.msg_type === "chat");
    fullHtml += buildMessageRowHtml(c, isConsecutive);
    prevSender = c.msg_type === "chat" ? c.sender_name : null;
  });

  lastRenderedSender = prevSender;
  container.innerHTML = fullHtml;
  syncAllChatCutButtons();
}

function appendSingleChatMessage(newMsg) {
  const container = document.getElementById("chatMessagesView");
  if (!container) return;

  const isConsecutive = (newMsg.sender_name === lastRenderedSender && newMsg.msg_type === "chat");
  const msgHtml = buildMessageRowHtml(newMsg, isConsecutive);

  lastRenderedSender = newMsg.msg_type === "chat" ? newMsg.sender_name : null;

  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = msgHtml;
  const child = tempDiv.firstElementChild;
  if (child) {
    container.appendChild(child);
  }

  syncAllChatCutButtons();
}

function buildMessageRowHtml(msg, isConsecutive = false) {
  const isMe = (msg.sender_name === myCurrentNick);
  const msgKey = "msg_" + msg.id;

  const dt = msg.created_at ? new Date(msg.created_at) : new Date();
  let hours = dt.getHours();
  const minutes = String(dt.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? '오후' : '오전';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const timeStr = `${ampm} ${hours}:${minutes}`;

  const cleanMessageText = msg.message || "";
  const isMentioned = myCurrentNick && cleanMessageText.includes(`@${myCurrentNick}`);

  let unreadCount = 0;
  if (isMe) {
    unreadCount = 1;
  } else {
    unreadCount = Math.max(1, (cachedMemberList.length || 2) - 1);
  }

  let senderAvatarIcon = "👤";
  const matchedSender = cachedMemberList.find(m => m.name === msg.sender_name);
  if (matchedSender && matchedSender.job_class) {
    senderAvatarIcon = matchedSender.job_class.split(' ')[0] || senderAvatarIcon;
  }
  if (isMe) {
    senderAvatarIcon = myCurrentAvatar || senderAvatarIcon;
  }

  let html = "";

  if (msg.msg_type === "boss_briefing") {
    html = `
      <div class="chat-item-row other" id="${msgKey}">
        <div class="chat-sender-avatar bot">🕒</div>
        <div class="chat-msg-body">
          <div class="chat-sender-name">보스알리미</div>
          <div class="chat-bubble-flex">
            ${cleanMessageText}
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
    let cardContent = cleanMessageText.includes("records-report-card") ? cleanMessageText : `<div class="records-report-card">${cleanMessageText}</div>`;
    html = `
      <div class="chat-item-row other" id="${msgKey}">
        <div class="chat-sender-avatar bot" style="background: rgba(14, 165, 233, 0.2) !important; border-color: #0ea5e9 !important; color: #0284c7 !important;">📊</div>
        <div class="chat-msg-body raid-msg-body">
          <div class="chat-sender-name">통계알리미</div>
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
      const totalAmount = Number(wishData.total_amount || 0).toLocaleString();
      const perMember = Number(wishData.per_member_amount || 0).toLocaleString();
      const members = wishData.members || [];
      const memberCount = members.length;
      const formattedItems = wishData.drop_items || "";

      let memberTagsHtml = "";
      if (members.length > 0) {
        memberTagsHtml = members.map(m => `<span class="badge bg-secondary bg-opacity-25 text-secondary px-2 py-1" style="font-size: 10px; border-radius: 4px;">${escapeHtmlText(m)}</span>`).join(' ');
      }

      html = `
        <div class="chat-item-row other" id="${msgKey}">
          <div class="chat-sender-avatar bot" style="background: rgba(56, 189, 248, 0.2) !important; border-color: #38bdf8 !important; color: #0284c7 !important;">🎁</div>
          <div class="chat-msg-body raid-msg-body">
            <div class="chat-sender-name">정산알리미</div>
            <div class="chat-bubble-flex">
              <div class="settle-wish-chat-card">
                <div class="settle-card-header">
                  <div class="d-flex align-items-center justify-content-between">
                    <strong style="font-size: 12px; color: var(--kakao-notice-text);"><i class="fa-solid fa-gift text-warning me-1"></i>[${escapeHtmlText(bossName)}] 분배 정산 보고</strong>
                    <span class="badge bg-success bg-opacity-25 text-success" style="font-size: 10px;">정산완료</span>
                  </div>
                  <div class="text-secondary small mt-1" style="font-size: 10px;">
                    <i class="fa-regular fa-clock me-1"></i>${timeStr}
                  </div>
                </div>

                <div class="settle-card-body">
                  <div class="d-flex justify-content-between align-items-center mb-1">
                    <span style="font-size: 11px; color: var(--kakao-time-gray);">총 분배 다이아:</span>
                    <strong style="color: #f59e0b; font-size: 12.5px;">${totalAmount} D</strong>
                  </div>
                  <div class="d-flex justify-content-between align-items-center mb-2">
                    <span style="font-size: 11px; color: var(--kakao-time-gray);">분배 대상 인원:</span>
                    <strong style="color: var(--kakao-notice-text); font-size: 11px;">참여자 ${memberCount}명</strong>
                  </div>

                  <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; padding: 6px 8px; margin-bottom: 7px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 11px; font-weight: 700; color: var(--kakao-notice-text);">💵 1인당 최종 배당금:</span>
                    <strong style="font-size: 13.5px; color: #10b981;">+${perMember} D</strong>
                  </div>

                  ${formattedItems ? `
                    <div style="margin-bottom: 6px; padding: 5px 7px; background: rgba(0,0,0,0.03); border-radius: 5px;">
                      <div style="font-size: 10px; color: var(--kakao-time-gray); margin-bottom: 2px;"><i class="fa-solid fa-coins text-warning me-1"></i>아이템 판매 정보:</div>
                      <div style="font-size: 10.5px; color: var(--kakao-notice-text); line-height: 1.4; word-break: break-all;">
                        ${escapeHtmlText(formattedItems).replace(/\n/g, '<br>')}
                      </div>
                    </div>
                  ` : ''}

                  <div style="margin-top: 5px;">
                    <div style="font-size: 10px; color: var(--kakao-time-gray); margin-bottom: 3px;">👥 배당 대상자 명단:</div>
                    <div class="d-flex flex-wrap gap-1">
                      ${memberTagsHtml}
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
      const warType = raidData.war_type || "일반";
      const score = raidData.score || 1;
      const dropItems = raidData.drop_items || "";
      const raidTimeDisplay = raidData.raid_time_display || timeStr;
      const createdAtIso = msg.created_at || new Date().toISOString();

      const members = raidData.members || [];
      const memberCount = members.length;

      const createdTimeMs = new Date(createdAtIso).getTime();
      const elapsedSec = Math.floor((Date.now() - createdTimeMs) / 1000);
      const remainingSec = Math.max(0, 180 - elapsedSec);
      const isExpired = (remainingSec <= 0);

      const activeNick = localStorage.getItem("guild_my_nickname") || "";
      const currentAdminRole = sessionStorage.getItem("admin_role") || "";
      const isSuperAdminAccount = (activeNick === "슈퍼관리자" || activeNick.toLowerCase() === "admin" || currentAdminRole === "super");
      const isAlreadyJoined = !isSuperAdminAccount && members.includes(activeNick);

      let btnDisabledAttr = "";
      let btnClassState = "active";
      let btnIconClass = "fa-user-plus";
      let btnTextLabel = "나도참여";

      if (isSuperAdminAccount) {
        btnDisabledAttr = "";
        btnClassState = "admin-mode";
        btnIconClass = "fa-pen-to-square";
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

      if (isAlreadyCut) {
        subCutButtonHtml = `
          <button type="button" class="btn-sub-cut completed" disabled>
            <i class="fa-solid fa-check me-1"></i>컷 완료됨
          </button>
        `;
      } else {
        subCutButtonHtml = `
          <button type="button" 
                  id="${btnId}" 
                  class="btn-sub-cut" 
                  data-boss-name="${escapeHtmlText(spawnedBossName)}" 
                  onclick="handleQuickBossCutAction(this, '${escapeHtmlText(spawnedBossName)}')">
            <i class="fa-solid fa-crosshairs me-1"></i>즉시 컷하기
          </button>
        `;
      }
    }

    html = `
      <div class="chat-item-row other" id="${msgKey}">
        <div class="chat-sender-avatar bot">⏰</div>
        <div class="chat-msg-body">
          <div class="chat-sender-name">보스알리미</div>
          <div class="chat-bubble-flex">
            <div class="boss-alert-card ${cardTypeClass}">
              <div class="alert-text-body">${formatMessageWithMentions(cleanMessageText)}</div>
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

  return html;
}

function syncAllChatCutButtons() {
  const now = Date.now();
  const buttons = document.querySelectorAll(".btn-sub-cut");

  buttons.forEach(btn => {
    const bossName = btn.getAttribute("data-boss-name");
    if (!bossName) return;

    const boss = cachedBossList.find(b => b.boss_name.toLowerCase() === bossName.toLowerCase());
    if (boss && boss.next_spawn_time) {
      const diffSec = Math.floor((new Date(boss.next_spawn_time).getTime() - now) / 1000);
      if (diffSec > 0) {
        btn.disabled = true;
        btn.classList.add("completed");
        btn.innerHTML = `<i class="fa-solid fa-check me-1"></i>컷 완료됨`;
      }
    }
  });
}

async function handleSendMessage() {
  const textarea = document.getElementById("inputChatMessage");
  const rawText = textarea.value.trim();
  if (!rawText) return;

  if (!myCurrentNick) {
    showKakaoToast("로그인 후 메시지를 전송할 수 있습니다.", "⚠️");
    showGuildLoginModal();
    return;
  }

  textarea.value = "";
  handleInputState(textarea);

  const matchedCut = rawText.match(/^!컷\s+([^\s]+)(?:\s+(\d{1,2}:\d{2}))?$/i);
  if (matchedCut) {
    const bName = matchedCut[1];
    const cutTime = matchedCut[2] || "";
    await executeBossCutCommand(bName, cutTime);
    return;
  }

  const matchedReserve = rawText.match(/^!예약\s+([^\s]+)\s+(\d{1,2}:\d{2})$/i);
  if (matchedReserve) {
    const bName = matchedReserve[1];
    const resTime = matchedReserve[2];
    await executeBossReserveCommand(bName, resTime);
    return;
  }

  const tempId = "temp_" + Date.now();
  const optimisticMsg = {
    id: tempId,
    sender_name: myCurrentNick,
    message: rawText,
    msg_type: "chat",
    created_at: new Date().toISOString()
  };

  pendingOptimisticMessages.push({ tempId, text: rawText, time: Date.now() });
  appendSingleChatMessage(optimisticMsg);
  scrollChatBottom();

  try {
    await apiRequest("guild_chats", "POST", [{
      sender_name: myCurrentNick,
      message: rawText,
      msg_type: "chat",
      mentions: []
    }]);
  } catch (e) {
    showKakaoToast("전송 실패: " + e.message, "❌");
  }
}

async function executeBossCutCommand(bossName, customTime) {
  const boss = cachedBossList.find(b => b.boss_name.toLowerCase() === bossName.toLowerCase());
  if (!boss) {
    showKakaoToast(`'${bossName}' 보스를 찾을 수 없습니다.`, "❌");
    return;
  }

  let cutBaseDate = new Date();
  if (customTime) {
    const [h, m] = customTime.split(":").map(Number);
    cutBaseDate.setHours(h, m, 0, 0);
  }

  const cycleMinutes = Number(boss.cycle_minutes) || 120;
  const nextSpawnDate = new Date(cutBaseDate.getTime() + cycleMinutes * 60 * 1000);
  const nextSpawnIso = nextSpawnDate.toISOString();

  try {
    await apiRequest(`boss_timers?id=eq.${boss.id}`, "PATCH", {
      next_spawn_time: nextSpawnIso,
      last_cut_time: cutBaseDate.toISOString()
    });

    const m = String(nextSpawnDate.getMinutes()).padStart(2, '0');
    const h = String(nextSpawnDate.getHours()).padStart(2, '0');
    const alertMsg = `⚔️ [${boss.boss_name}] ${myCurrentNick}님이 컷 등록 완료! 다음 젠: ${h}:${m}`;

    await apiRequest("guild_chats", "POST", [{
      sender_name: "보스알리미",
      message: alertMsg,
      msg_type: "boss_alert",
      mentions: []
    }]);

    await loadBossTimersList();
    showKakaoToast(`[${boss.boss_name}] 컷 완료! 다음 젠: ${h}:${m}`, "⚔️");
  } catch (e) {
    showKakaoToast("컷 처리 실패: " + e.message, "❌");
  }
}

async function executeBossReserveCommand(bossName, targetTime) {
  const boss = cachedBossList.find(b => b.boss_name.toLowerCase() === bossName.toLowerCase());
  if (!boss) {
    showKakaoToast(`'${bossName}' 보스를 찾을 수 없습니다.`, "❌");
    return;
  }

  const [h, m] = targetTime.split(":").map(Number);
  const targetDate = new Date();
  targetDate.setHours(h, m, 0, 0);

  if (targetDate.getTime() < Date.now() - 60000) {
    targetDate.setDate(targetDate.getDate() + 1);
  }

  const nextSpawnIso = targetDate.toISOString();

  try {
    await apiRequest(`boss_timers?id=eq.${boss.id}`, "PATCH", {
      next_spawn_time: nextSpawnIso
    });

    const hStr = String(targetDate.getHours()).padStart(2, '0');
    const mStr = String(targetDate.getMinutes()).padStart(2, '0');
    const alertMsg = `📌 [${boss.boss_name}] ${myCurrentNick}님이 젠 시간 예약: ${hStr}:${mStr}`;

    await apiRequest("guild_chats", "POST", [{
      sender_name: "보스알리미",
      message: alertMsg,
      msg_type: "boss_alert",
      mentions: []
    }]);

    await loadBossTimersList();
    showKakaoToast(`[${boss.boss_name}] ${hStr}:${mStr} 예약 완료!`, "📌");
  } catch (e) {
    showKakaoToast("예약 실패: " + e.message, "❌");
  }
}

async function handleQuickBossCutAction(btnElem, bossName) {
  if (!myCurrentNick) {
    showKakaoToast("로그인 후 이용 가능합니다.", "⚠️");
    return;
  }

  const boss = cachedBossList.find(b => b.boss_name.toLowerCase() === bossName.toLowerCase());
  if (!boss) {
    showKakaoToast(`'${bossName}' 보스 정보를 찾을 수 없습니다.`, "❌");
    return;
  }

  const now = new Date();
  const cycleMinutes = Number(boss.cycle_minutes) || 120;
  const nextSpawnDate = new Date(now.getTime() + cycleMinutes * 60 * 1000);
  const nextSpawnIso = nextSpawnDate.toISOString();

  btnElem.disabled = true;
  btnElem.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-1"></i>처리중...`;

  try {
    await apiRequest(`boss_timers?id=eq.${boss.id}`, "PATCH", {
      next_spawn_time: nextSpawnIso,
      last_cut_time: now.toISOString()
    });

    const m = String(nextSpawnDate.getMinutes()).padStart(2, '0');
    const h = String(nextSpawnDate.getHours()).padStart(2, '0');
    const alertMsg = `⚔️ [${boss.boss_name}] ${myCurrentNick}님이 즉시 컷 완료! 다음 젠: ${h}:${m}`;

    await apiRequest("guild_chats", "POST", [{
      sender_name: "보스알리미",
      message: alertMsg,
      msg_type: "boss_alert",
      mentions: []
    }]);

    btnElem.classList.add("completed");
    btnElem.innerHTML = `<i class="fa-solid fa-check me-1"></i>컷 완료됨`;

    await loadBossTimersList();
    showKakaoToast(`[${boss.boss_name}] 컷 완료! (${h}:${m})`, "⚔️");
  } catch (e) {
    btnElem.disabled = false;
    btnElem.innerHTML = `<i class="fa-solid fa-crosshairs me-1"></i>즉시 컷하기`;
    showKakaoToast("컷 처리 오류: " + e.message, "❌");
  }
}

async function handleQuickRaidSelfAdd(raidId, bossName) {
  if (!myCurrentNick) {
    showKakaoToast("로그인 후 참여 등록이 가능합니다.", "⚠️");
    showGuildLoginModal();
    return;
  }

  const activeNick = localStorage.getItem("guild_my_nickname") || "";
  const currentAdminRole = sessionStorage.getItem("admin_role") || "";
  const isSuperAdminAccount = (activeNick === "슈퍼관리자" || activeNick.toLowerCase() === "admin" || currentAdminRole === "super");

  if (isSuperAdminAccount) {
    openModulePage("PageRecords");
    return;
  }

  const btn = document.getElementById("btnRaidAdd_" + raidId);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-1"></i>등록중`;
  }

  try {
    const list = await apiRequest(`guild_chats?id=eq.${raidId}`);
    if (!list || list.length === 0) {
      showKakaoToast("토벌 보고 메시지를 찾을 수 없습니다.", "❌");
      if (btn) btn.disabled = false;
      return;
    }

    const targetRow = list[0];
    let raidData = null;
    try {
      raidData = typeof targetRow.message === "object" ? targetRow.message : JSON.parse(targetRow.message);
    } catch (e) {
      raidData = null;
    }

    if (!raidData) {
      showKakaoToast("토벌 데이터 형식이 올바르지 않습니다.", "❌");
      if (btn) btn.disabled = false;
      return;
    }

    const members = raidData.members || [];
    if (members.includes(activeNick)) {
      showKakaoToast("이미 참여 등록된 토벌입니다.", "ℹ️");
      if (btn) {
        btn.classList.remove("active");
        btn.classList.add("joined");
        btn.innerHTML = `<i class="fa-solid fa-check me-1"></i>참여완료`;
      }
      return;
    }

    members.push(activeNick);
    raidData.members = members;

    await apiRequest(`guild_chats?id=eq.${raidId}`, "PATCH", {
      message: JSON.stringify(raidData)
    });

    const countElem = document.getElementById(`raid_mcount_${raidId}`);
    const listElem = document.getElementById(`raid_mlist_${raidId}`);

    if (countElem) countElem.innerText = members.length;
    if (listElem) {
      const newPill = document.createElement("span");
      newPill.className = "raid-member-pill";
      newPill.innerText = activeNick;
      listElem.appendChild(newPill);
    }

    if (btn) {
      btn.disabled = true;
      btn.classList.remove("active");
      btn.classList.add("joined");
      btn.innerHTML = `<i class="fa-solid fa-check me-1"></i>참여완료`;
    }

    showKakaoToast(`[${bossName}] 토벌 참여가 성공적으로 등록되었습니다!`, "🎉");
  } catch (e) {
    if (btn) btn.disabled = false;
    showKakaoToast("참여 등록 실패: " + e.message, "❌");
  }
}

function startBossSpawnWatcher() {
  if (bossWatcherInterval) clearInterval(bossWatcherInterval);

  bossWatcherInterval = setInterval(async () => {
    if (!cachedBossList || cachedBossList.length === 0) return;

    const now = Date.now();
    for (let boss of cachedBossList) {
      if (!boss.next_spawn_time) continue;

      const spawnTime = new Date(boss.next_spawn_time).getTime();
      const diffSec = Math.floor((spawnTime - now) / 1000);

      const spawnTimeKey = new Date(boss.next_spawn_time).toISOString().slice(0, 16);
      const key7m = `${boss.id}_7m_${spawnTimeKey}`;
      const key3m = `${boss.id}_3m_${spawnTimeKey}`;
      const keySpawn = `${boss.id}_spawn_${spawnTimeKey}`;

      if (diffSec <= 420 && diffSec > 360 && !notifiedBossSpawnMap.has(key7m)) {
        saveNotifiedBossKey(key7m);
        await sendBossAlertMessage(boss.boss_name, "7분 전", boss.location);
      } else if (diffSec <= 180 && diffSec > 120 && !notifiedBossSpawnMap.has(key3m)) {
        saveNotifiedBossKey(key3m);
        await sendBossAlertMessage(boss.boss_name, "3분 전", boss.location);
      } else if (diffSec <= 0 && diffSec > -120 && !notifiedBossSpawnMap.has(keySpawn)) {
        saveNotifiedBossKey(keySpawn);
        await sendBossAlertMessage(boss.boss_name, "출현", boss.location);
      }
    }

    updateActiveRaidTimers();
  }, 1000);
}

function updateActiveRaidTimers() {
  const timerBadges = document.querySelectorAll(".badge-raid-timer.active");
  const now = Date.now();

  timerBadges.forEach(badge => {
    const createdAtIso = badge.getAttribute("data-created-at");
    const raidId = badge.getAttribute("data-raid-id");
    if (!createdAtIso) return;

    const createdMs = new Date(createdAtIso).getTime();
    const elapsedSec = Math.floor((now - createdMs) / 1000);
    const remainSec = Math.max(0, 180 - elapsedSec);

    const timeSpan = badge.querySelector(".time-text");

    if (remainSec <= 0) {
      badge.classList.remove("active");
      badge.classList.add("expired");
      if (timeSpan) timeSpan.innerText = "마감";

      const btn = document.getElementById("btnRaidAdd_" + raidId);
      if (btn && !btn.classList.contains("joined") && !btn.classList.contains("admin-mode")) {
        btn.disabled = true;
        btn.classList.remove("active");
        btn.classList.add("disabled");
        const btnText = btn.querySelector(".btn-text");
        if (btnText) btnText.innerText = "마감됨";
      }
    } else {
      const m = String(Math.floor(remainSec / 60)).padStart(2, '0');
      const s = String(remainSec % 60).padStart(2, '0');
      if (timeSpan) timeSpan.innerText = `${m}:${s}`;
    }
  });
}

async function sendBossAlertMessage(bossName, alertType, location = "") {
  try {
    const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const checkRes = await apiRequest(`guild_chats?sender_name=eq.보스알리미&created_at=gte.${threeMinAgo}&message=like.*[${encodeURIComponent(bossName)}]*${encodeURIComponent(alertType)}*&limit=1`);

    if (checkRes && checkRes.length > 0) return;

    let alertText = "";
    if (alertType === "7분 전") {
      alertText = `⏳ [${bossName}] 보스 출현 7분 전입니다! 준비하세요. (${location || '위치 미지정'})`;
    } else if (alertType === "3분 전") {
      alertText = `⚡ [${bossName}] 보스 출현 3분 전! 집결지로 이동하세요! (${location || '위치 미지정'})`;
    } else if (alertType === "출현") {
      alertText = `🚨 [${bossName}] 보스가 출현했습니다! 즉시 토벌을 시작하세요! (${location || '위치 미지정'})`;
    }

    await apiRequest("guild_chats", "POST", [{
      sender_name: "보스알리미",
      message: alertText,
      msg_type: "boss_alert",
      mentions: []
    }]);
  } catch (e) {}
}

function extractBossNameFromMessage(text) {
  if (!text) return "";
  const match = text.match(/\[([^\]]+)\]/);
  return match ? match[1] : "";
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
    "PageSettings": "시스템 설정"
  };

  navTitle.innerText = titleMap[pageName] || "기능 화면";
  if (typeof window.applyAppTheme === "function") window.applyAppTheme();
  overlay.style.display = "flex";
  body.innerHTML = `<div class="text-secondary small text-center py-5"><i class="fa-solid fa-spinner fa-spin me-2"></i>화면을 불러오는 중...</div>`;

  try {
    const res = await fetch(`pages/${pageName}.html`);
    if (!res.ok) throw new Error("페이지 파일을 불러오지 못했습니다.");
    const htmlText = await res.text();

    body.innerHTML = htmlText;

    const scripts = body.querySelectorAll("script");
    scripts.forEach(oldScript => {
      const newScript = document.createElement("script");
      Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
      newScript.appendChild(document.createTextNode(oldScript.innerHTML));
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });

    if (pageName === "PageSettings" && typeof window.initSettingsModule === "function") {
      window.initSettingsModule();
    }
  } catch (err) {
    body.innerHTML = `
      <div class="text-danger small text-center py-5">
        <i class="fa-solid fa-triangle-exclamation mb-2" style="font-size: 1.5rem;"></i>
        <div>${err.message}</div>
      </div>
    `;
  }
};

window.closeModuleOverlay = function() {
  document.getElementById("moduleOverlay").style.display = "none";
  document.getElementById("overlayBodyContent").innerHTML = "";
};

function checkEnterKey(e) {
  if (e.keyCode === 13 && !e.shiftKey) {
    e.preventDefault();
    handleSendMessage();
  }
}

function handleInputState(textarea) {
  const btn = document.getElementById("btnKakaoSend");
  if (textarea.value.trim().length > 0) {
    btn.classList.add("active");
  } else {
    btn.classList.remove("active");
  }
}

function scrollChatBottom() {
  const box = document.getElementById("chatMessagesView");
  box.scrollTop = box.scrollHeight;
}

function escapeHtmlText(t) {
  return (t || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
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

// ==========================================
// 🔍 [카카오톡 대화 검색 (선택지 A: 7일 보관 안내)]
// ==========================================
window.toggleChatSearchBar = function(forceState) {
  const bar = document.getElementById('chatSearchBarArea');
  const btn = document.getElementById('btnToggleChatSearch');
  if (!bar) return;

  const isOpen = (bar.style.display !== 'none');
  const shouldOpen = (forceState !== undefined) ? forceState : !isOpen;

  if (shouldOpen) {
    bar.style.display = 'block';
    if (btn) btn.classList.add('active');
    setTimeout(() => {
      const input = document.getElementById('chatSearchKeywordInput');
      if (input) input.focus();
    }, 100);
  } else {
    bar.style.display = 'none';
    if (btn) btn.classList.remove('active');
    clearChatSearch();
  }
};

window.handleSearchChatMessages = function(rawKeyword) {
  const q = (rawKeyword || '').trim().toLowerCase();
  const countElem = document.getElementById('chatSearchMatchCount');
  const container = document.getElementById('chatMessagesView');
  if (!container) return;

  const rows = container.querySelectorAll('.chat-item-row');
  if (!q) {
    if (countElem) countElem.innerText = '';
    rows.forEach(r => {
      r.style.opacity = '1';
      r.style.transform = 'none';
    });
    return;
  }

  let matchCount = 0;
  let lastMatchedRow = null;

  rows.forEach(r => {
    const text = (r.innerText || '').toLowerCase();
    if (text.includes(q)) {
      matchCount++;
      r.style.opacity = '1';
      lastMatchedRow = r;
    } else {
      r.style.opacity = '0.35';
    }
  });

  if (countElem) {
    countElem.innerText = matchCount > 0 ? (matchCount + '건 발견') : '일치 항목 없음';
  }

  if (lastMatchedRow) {
    lastMatchedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

window.clearChatSearch = function() {
  const input = document.getElementById('chatSearchKeywordInput');
  const countElem = document.getElementById('chatSearchMatchCount');
  if (input) input.value = '';
  if (countElem) countElem.innerText = '';
  
  const container = document.getElementById('chatMessagesView');
  if (container) {
    container.querySelectorAll('.chat-item-row').forEach(r => {
      r.style.opacity = '1';
      r.style.transform = 'none';
    });
  }
};

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

// 모달 열기/닫기 전역 호환 별칭
window.openGuildLoginModal = showGuildLoginModal;
window.closeGuildLoginModal = function() {
  const m = document.getElementById("guildLoginModal");
  if (m) m.style.display = "none";
};

window.addEventListener("DOMContentLoaded", initApp);
