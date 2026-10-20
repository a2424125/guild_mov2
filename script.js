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

  updateHeaderUserDisplay();
  await loadGuildSettings();
  await loadGuildMembersData();
  await loadBossTimersList();
  await loadTopNoticeHeader();

  await checkUserLoginStatus();

  await loadInitialChatMessages();
  listenRealtimeChatMessages();

  startBossSpawnWatcher();
  cleanupOldChatsBackground();
}

async function loadGuildSettings() {
  try {
    const settings = await apiRequest("guild_settings?select=*");
    if (!settings) return;

    window.currentSettingsMap = {};
    settings.forEach(s => {
      window.currentSettingsMap[s.key] = s.value;
      if (s.key === "guild_name") {
        document.getElementById("chatRoomTitle").innerText = s.value || "길드 대화방";
        document.getElementById("menuGuildNameText").innerText = s.value || "길드 메뉴";
        document.getElementById("loginGuildTitle").innerText = `${s.value || '길드'} 로그인`;
        document.title = `${s.value || '길드'} 대화방`;
      }
    });
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
    document.getElementById("roomMemberCountText").innerText = cachedMemberList.length;
    renderMembersSidebarList(cachedMemberList);
    populateLoginMemberSelect(cachedMemberList);
  } catch (e) {}
};

function updateHeaderUserDisplay() {
  myCurrentNick = localStorage.getItem("guild_my_nickname") || "";
  myCurrentClass = localStorage.getItem("guild_my_class") || "미설정";
  myCurrentAvatar = localStorage.getItem("guild_my_avatar") || "👤";

  const nickElem = document.getElementById("sidebarUserNickName");
  const classElem = document.getElementById("sidebarUserClassText");
  const avatarElem = document.getElementById("sidebarAvatarIcon");

  if (nickElem) nickElem.innerText = myCurrentNick || "로그인 필요";
  if (classElem) classElem.innerText = myCurrentClass || "직업 설정하기";
  if (avatarElem) avatarElem.innerText = myCurrentAvatar || "👤";
}

async function checkUserLoginStatus() {
  if (!myCurrentNick) {
    openGuildLoginModal();
    return;
  }

  try {
    const res = await apiRequest(`guild_members?name=eq.${encodeURIComponent(myCurrentNick)}&select=*`);
    if (!res || res.length === 0) {
      handleUserLogout(false);
      openGuildLoginModal();
    } else {
      const u = res[0];
      myCurrentClass = u.job_class || myCurrentClass;
      localStorage.setItem("guild_my_class", myCurrentClass);
      localStorage.setItem("guild_my_role", u.role || "일반");
      updateHeaderUserDisplay();
    }
  } catch (e) {}
}

function openGuildLoginModal() {
  document.getElementById("guildLoginModal").style.display = "flex";
  setTimeout(() => {
    document.getElementById("loginNickSearchInput").focus();
  }, 100);
}

function closeGuildLoginModal() {
  document.getElementById("guildLoginModal").style.display = "none";
}

function populateLoginMemberSelect(list) {
  const select = document.getElementById("loginMemberSelect");
  if (!select) return;
  select.innerHTML = '<option value="">닉네임을 선택하세요...</option>';
  list.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.innerText = `${m.name} (${m.job_class || '미설정'})`;
    select.appendChild(opt);
  });
}

function onLoginSearchInput(val) {
  const q = val.trim().toLowerCase();
  const select = document.getElementById("loginMemberSelect");
  if (!select) return;

  if (!q) {
    populateLoginMemberSelect(cachedMemberList);
    return;
  }

  const filtered = cachedMemberList.filter(m => m.name.toLowerCase().includes(q));
  select.innerHTML = '<option value="">닉네임을 선택하세요...</option>';
  filtered.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.innerText = `${m.name} (${m.job_class || '미설정'})`;
    select.appendChild(opt);
  });

  if (filtered.length === 1) {
    select.value = filtered[0].name;
  }
}

function onLoginSelectChange(val) {
  if (val) {
    document.getElementById("loginNickSearchInput").value = val;
    document.getElementById("loginPinInput").focus();
  }
}

async function executeGuildLogin() {
  const nickInput = document.getElementById("loginNickSearchInput").value.trim();
  const selectVal = document.getElementById("loginMemberSelect").value;
  const pinVal = document.getElementById("loginPinInput").value.trim();

  const finalNick = selectVal || nickInput;

  if (!finalNick) {
    showKakaoToast("닉네임을 입력하거나 선택해 주세요.", "⚠️");
    return;
  }

  if (finalNick === "슈퍼관리자") {
    try {
      const res = await apiRequest(`guild_settings?key=eq.super_admin_pin&select=value`);
      const masterPin = (res && res[0] && res[0].value) ? res[0].value : "0000";
      if (pinVal === masterPin) {
        localStorage.setItem("guild_my_nickname", "슈퍼관리자");
        localStorage.setItem("guild_my_pin", pinVal);
        localStorage.setItem("guild_my_role", "길드장");
        localStorage.setItem("guild_my_avatar", "👑");
        localStorage.setItem("guild_my_class", "군주");
        sessionStorage.setItem("admin_role", "super");

        updateHeaderUserDisplay();
        closeGuildLoginModal();
        showKakaoToast("👑 최고 관리자로 로그인되었습니다.", "✅");
        return;
      } else {
        showKakaoToast("관리자 비밀번호가 일치하지 않습니다.", "❌");
        return;
      }
    } catch (e) {
      showKakaoToast("로그인 검증 오류: " + e.message, "❌");
      return;
    }
  }

  try {
    const res = await apiRequest(`guild_members?name=eq.${encodeURIComponent(finalNick)}&select=*`);
    if (!res || res.length === 0) {
      showKakaoToast("등록된 길드원이 아닙니다. 닉네임을 확인하세요.", "❌");
      return;
    }

    const member = res[0];

    if (!member.pin || member.pin.trim() === "") {
      if (!pinVal) {
        showKakaoToast("새로 설정할 개인 비밀번호를 입력해 주세요.", "ℹ️");
        return;
      }
      await apiRequest(`guild_members?id=eq.${member.id}`, "PATCH", { pin: pinVal });
      member.pin = pinVal;
      showKakaoToast("비밀번호가 안전하게 최초 등록되었습니다.", "🔒");
    } else {
      if (member.pin !== pinVal) {
        showKakaoToast("비밀번호가 일치하지 않습니다.", "❌");
        return;
      }
    }

    localStorage.setItem("guild_my_nickname", member.name);
    localStorage.setItem("guild_my_pin", member.pin);
    localStorage.setItem("guild_my_role", member.role || "일반");
    localStorage.setItem("guild_my_avatar", (member.job_class || "👤").split(" ")[0]);
    localStorage.setItem("guild_my_class", member.job_class || "미설정");

    const role = member.role || "일반";
    if (role === "길드장" || role === "길마") {
      sessionStorage.setItem("admin_role", "super");
    } else if (role === "부길드장" || role === "부길마") {
      sessionStorage.setItem("admin_role", "admin");
    } else if (role === "정예") {
      sessionStorage.setItem("admin_role", "elite");
    } else {
      sessionStorage.removeItem("admin_role");
    }

    updateHeaderUserDisplay();
    closeGuildLoginModal();
    showKakaoToast(`${member.name}님 환영합니다!`, "👋");
  } catch (e) {
    showKakaoToast("로그인 실패: " + e.message, "❌");
  }
}

function handleUserLogout(confirmNeeded = true) {
  if (confirmNeeded && !confirm("정말 로그아웃 하시겠습니까?")) return;

  localStorage.removeItem("guild_my_nickname");
  localStorage.removeItem("guild_my_pin");
  localStorage.removeItem("guild_my_role");
  localStorage.removeItem("guild_my_avatar");
  localStorage.removeItem("guild_my_class");
  sessionStorage.removeItem("admin_role");

  updateHeaderUserDisplay();
  closeAllDrawers();
  openGuildLoginModal();
  showKakaoToast("로그아웃 되었습니다.", "👋");
}

function openProfileEditModal() {
  document.getElementById("modalProfileEdit").style.display = "flex";
}

function closeProfileEditModal() {
  document.getElementById("modalProfileEdit").style.display = "none";
}

async function selectClassProfile(icon, className) {
  if (!myCurrentNick) {
    showKakaoToast("로그인 후 직업을 변경할 수 있습니다.", "⚠️");
    closeProfileEditModal();
    return;
  }

  const fullJobStr = `${icon} ${className}`;
  try {
    if (myCurrentNick !== "슈퍼관리자") {
      await apiRequest(`guild_members?name=eq.${encodeURIComponent(myCurrentNick)}`, "PATCH", { job_class: fullJobStr });
    }
    localStorage.setItem("guild_my_avatar", icon);
    localStorage.setItem("guild_my_class", fullJobStr);
    updateHeaderUserDisplay();
    closeProfileEditModal();
    showKakaoToast(`${fullJobStr}(으)로 직업이 변경되었습니다!`, "✨");
  } catch (e) {
    showKakaoToast("직업 변경 실패: " + e.message, "❌");
  }
}

function toggleMenuDrawer(open) {
  const drawer = document.getElementById("menuSidebarDrawer");
  const backdrop = document.getElementById("commonDrawerBackdrop");
  if (open) {
    closeAllDrawers();
    drawer.classList.add("open");
    backdrop.classList.add("show");
  } else {
    drawer.classList.remove("open");
    backdrop.classList.remove("show");
  }
}

function toggleMembersDrawer(open) {
  const drawer = document.getElementById("membersSidebarDrawer");
  const backdrop = document.getElementById("commonDrawerBackdrop");
  if (open) {
    closeAllDrawers();
    drawer.classList.add("open");
    backdrop.classList.add("show");
    loadGuildMembersData();
  } else {
    drawer.classList.remove("open");
    backdrop.classList.remove("show");
  }
}

function toggleBossDrawer(open) {
  const drawer = document.getElementById("bossTimerSidebarDrawer");
  const backdrop = document.getElementById("commonDrawerBackdrop");
  if (open) {
    closeAllDrawers();
    drawer.classList.add("open");
    backdrop.classList.add("show");
    renderBossDrawerList();
  } else {
    drawer.classList.remove("open");
    backdrop.classList.remove("show");
  }
}

function closeAllDrawers() {
  document.getElementById("menuSidebarDrawer").classList.remove("open");
  document.getElementById("membersSidebarDrawer").classList.remove("open");
  document.getElementById("bossTimerSidebarDrawer").classList.remove("open");
  document.getElementById("commonDrawerBackdrop").classList.remove("show");
}

function renderMembersSidebarList(list) {
  const container = document.getElementById("drawerMembersContainer");
  if (!container) return;

  const rolesOrder = { "길드장": 1, "길마": 1, "부길드장": 2, "부길마": 2, "정예": 3, "일반": 4 };

  const sorted = [...list].sort((a, b) => {
    const rA = rolesOrder[a.role] || 99;
    const rB = rolesOrder[b.role] || 99;
    if (rA !== rB) return rA - rB;
    return a.name.localeCompare(b.name, 'ko');
  });

  const html = `
    <div class="members-drawer-header">
      <div class="d-flex align-items-center gap-2">
        <i class="fa-solid fa-user-group text-primary"></i>
        <span>길드원 목록 (${sorted.length})</span>
      </div>
      <button type="button" class="sidebar-close-btn" onclick="toggleMembersDrawer(false)">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div class="members-scroll-area">
      ${sorted.map(m => {
        let badgeClass = "badge-general";
        if (m.role === "길드장" || m.role === "길마") badgeClass = "badge-master";
        else if (m.role === "부길드장" || m.role === "부길마") badgeClass = "badge-submaster";
        else if (m.role === "정예") badgeClass = "badge-elite";

        const avatar = (m.job_class || "👤").split(" ")[0];
        const job = m.job_class || "미설정";

        return `
          <div class="member-list-card">
            <div class="member-avatar-box">${avatar}</div>
            <div class="member-info-box">
              <div class="member-name-row">
                <span class="member-name-text">${escapeHtmlText(m.name)}</span>
                <span class="member-role-badge ${badgeClass}">${escapeHtmlText(m.role || '일반')}</span>
              </div>
              <div class="member-job-text">${escapeHtmlText(job)}</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
  container.innerHTML = html;
}

async function renderBossDrawerList() {
  const area = document.getElementById("drawerBossListArea");
  if (!area) return;

  try {
    const bosses = await apiRequest("boss_timers?select=*&order=id.asc");
    cachedBossList = bosses || [];
    if (cachedBossList.length === 0) {
      area.innerHTML = `<div class="text-secondary small text-center py-5">등록된 보스가 없습니다.</div>`;
      return;
    }

    const now = Date.now();
    const sorted = [...cachedBossList].map(b => {
      let diff = 0;
      let isSpawned = false;
      if (b.next_spawn_time) {
        diff = Math.floor((new Date(b.next_spawn_time).getTime() - now) / 1000);
        if (diff <= 0) isSpawned = true;
      }
      return { ...b, diffSec: diff, isSpawned };
    }).sort((a, b) => {
      if (a.isSpawned && !b.isSpawned) return -1;
      if (!a.isSpawned && b.isSpawned) return 1;
      return a.diffSec - b.diffSec;
    });

    area.innerHTML = `
      <div style="padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;">
        ${sorted.map(b => {
          let timeDisplay = "--:--";
          let badgeState = "badge-wait";
          let statusText = "대기중";

          if (b.next_spawn_time) {
            if (b.diffSec <= 0) {
              badgeState = "badge-spawn";
              statusText = "출현중";
              timeDisplay = "등장 완료";
            } else {
              const m = Math.floor(b.diffSec / 60);
              const s = b.diffSec % 60;
              timeDisplay = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
              if (b.diffSec <= 180) {
                badgeState = "badge-imminent";
                statusText = "임박";
              }
            }
          }

          return `
            <div class="boss-drawer-card">
              <div class="boss-card-info">
                <div class="boss-name-text">${escapeHtmlText(b.boss_name)}</div>
                <div class="boss-loc-text">${escapeHtmlText(b.location || '위치 미지정')}</div>
              </div>
              <div class="boss-card-status">
                <span class="boss-time-text">${timeDisplay}</span>
                <span class="boss-status-badge ${badgeState}">${statusText}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (e) {
    area.innerHTML = `<div class="text-danger small text-center py-4">조회 실패: ${e.message}</div>`;
  }
}

async function handleBossDrawerRefresh() {
  const btn = document.getElementById("btnRefreshBossDrawer");
  if (btn) btn.classList.add("fa-spin");
  await renderBossDrawerList();
  setTimeout(() => {
    if (btn) btn.classList.remove("fa-spin");
    showKakaoToast("보스타임이 동기화되었습니다.", "🔄");
  }, 400);
}

window.postBossBriefingToChat = async function() {
  if (!cachedBossList || cachedBossList.length === 0) {
    await loadBossTimersList();
  }

  const now = Date.now();
  const sorted = [...cachedBossList].map(b => {
    let diff = 0;
    let isSpawned = false;
    if (b.next_spawn_time) {
      diff = Math.floor((new Date(b.next_spawn_time).getTime() - now) / 1000);
      if (diff <= 0) isSpawned = true;
    }
    return { ...b, diffSec: diff, isSpawned };
  }).sort((a, b) => {
    if (a.isSpawned && !b.isSpawned) return -1;
    if (!a.isSpawned && b.isSpawned) return 1;
    return a.diffSec - b.diffSec;
  });

  const nowDt = new Date();
  const nowH = String(nowDt.getHours()).padStart(2, '0');
  const nowM = String(nowDt.getMinutes()).padStart(2, '0');
  const currentTimeStr = `${nowH}:${nowM}`;

  const topItems = sorted.slice(0, 6);
  const itemsHtml = topItems.map(b => {
    let statusText = "대기";
    let colorStyle = "color: var(--kakao-time-gray);";
    if (b.isSpawned) {
      statusText = "🔥 출현중";
      colorStyle = "color: #ef4444; font-weight: 800;";
    } else if (b.diffSec <= 180) {
      const m = Math.floor(b.diffSec / 60);
      const s = b.diffSec % 60;
      statusText = `⏳ ${m}분 ${s}초`;
      colorStyle = "color: #f59e0b; font-weight: 800;";
    } else {
      const m = Math.floor(b.diffSec / 60);
      statusText = `${m}분 후`;
    }

    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 3px 0; font-size: 11.5px; border-bottom: 1px dashed var(--drawer-card-border);">
        <span style="font-weight: 700; color: var(--kakao-notice-text);">${escapeHtmlText(b.boss_name)}</span>
        <span style="${colorStyle}">${statusText}</span>
      </div>
    `;
  }).join('');

  const reportCardHtml = `
    <div class="boss-briefing-card" style="background: var(--drawer-card-bg); border: 1px solid var(--drawer-card-border); border-radius: 12px; padding: 10px 12px; width: 260px; max-width: 100%;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid var(--drawer-card-border);">
        <span style="font-weight: 800; font-size: 12px; color: var(--kakao-notice-text);"><i class="fa-solid fa-clock text-warning me-1"></i>실시간 보스타임 현황</span>
        <span style="font-size: 10px; color: var(--kakao-time-gray);">${currentTimeStr} 기준</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 2px;">
        ${itemsHtml}
      </div>
      <div style="text-align: right; margin-top: 6px;">
        <span style="font-size: 9.5px; color: var(--kakao-time-gray);">* 3분 전/젠 알림이 자동으로 전송됩니다</span>
      </div>
    </div>
  `;

  try {
    await apiRequest("guild_chats", "POST", [{
      sender_name: "보스알리미",
      message: reportCardHtml,
      msg_type: "boss_briefing",
      mentions: []
    }]);
    showKakaoToast("보스타임 현황이 대화방에 공유되었습니다.", "🕒");
  } catch (e) {
    showKakaoToast("공유 실패: " + e.message, "❌");
  }
};

async function loadInitialChatMessages() {
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
    openGuildLoginModal();
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
    openGuildLoginModal();
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

window.addEventListener("DOMContentLoaded", initApp);
