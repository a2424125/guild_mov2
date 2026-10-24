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

  box.style.zIndex = "10000010";
  m.innerText = msg;
  ic.innerText = icon;
  box.classList.add("show");

  if (kakaoToastTimer) clearTimeout(kakaoToastTimer);
  kakaoToastTimer = setTimeout(() => box.classList.remove("show"), 2600);
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

window.addEventListener("storage", function(e) {
  if (e.key === "guild_theme_mode") window.applyAppTheme(e.newValue);
});

async function initApp() {
  if (typeof window.applyAppTheme === 'function') window.applyAppTheme();
  if (window.supabase && typeof SUPABASE_CONFIG !== 'undefined') {
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
    window.supabaseClient = supabaseClient;
  }

  // ⚡ [세션 보호]: 저장된 로그인 닉네임과 직업이 유실되지 않도록 항상 동기화
  myCurrentNick = localStorage.getItem("guild_my_nickname") || "";
  myCurrentPin = localStorage.getItem("guild_my_pin") || "";
  myCurrentClass = localStorage.getItem("guild_my_class") || "직업 미지정";
  myCurrentAvatar = localStorage.getItem("guild_my_avatar") || "👤";

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
    if (typeof window.loadMainTabRoomsList === 'function') {
      window.loadMainTabRoomsList();
    }
    if (myCurrentPin === "000000" || myCurrentPin === "0000") {
      setTimeout(() => {
        openForceChangePinModal();
      }, 400);
    }
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

    // 1. 현재 길드 ID로 조회 시도 (DB 컬럼 의존 오류 방지를 위해 order 없이 select=*)
    if (currentGid) {
      try {
        members = await apiRequest("guild_members?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*");
      } catch (err) {}
    }

    // 2. 만약 길드 ID 매칭 멤버가 비어있거나 실패한 경우, 전체 멤버에서 안전 복구
    if (!members || members.length === 0) {
      try {
        members = await apiRequest("guild_members?select=*");
        if (members && members.length > 0 && currentGid && members[0].guild_id) {
          const matchedGid = members.find(m => m.guild_id)?.guild_id;
          if (matchedGid) localStorage.setItem("current_guild_id", matchedGid);
        }
      } catch (err2) {}
    }

    cachedMemberList = members || [];
    window.cachedMemberList = cachedMemberList;

    // 자바스크립트 메모리 정렬 (DB 쿼리 에러 원천 방지)
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
  } catch (e) {
    console.error("loadGuildMembersData error:", e);
  }
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

window.openProfileEditModal = function openProfileEditModal() {
  document.getElementById("modalProfileEdit").style.display = "flex";
}
window.closeProfileEditModal = function closeProfileEditModal() {
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
// 4. 길드 로그인 / 로그아웃 / 초기 비밀번호(000000) 변경 모달 제어
// --------------------------------------------------------
function ensureForceChangePinModalExists() {
  let modal = document.getElementById("modalForceChangePin");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "modalForceChangePin";
  modal.className = "kakao-modal-backdrop";
  modal.style.display = "none";
  modal.style.zIndex = "10000005";
  modal.innerHTML = `
    <div class="kakao-modal-card" style="max-width: 320px;">
      <div class="mb-2" style="font-size: 2rem;">🔐</div>
      <h6 class="fw-bold mb-1" style="font-size: 0.98rem;">비밀번호를 변경하세요</h6>
      <p class="text-secondary small mb-3" style="font-size: 0.74rem; line-height: 1.45;">
        현재 초기 비밀번호(<strong>000000</strong>)를 사용 중입니다.<br>안전한 계정 보호를 위해 새로운 6자리 비밀번호로 변경해 주세요.
      </p>
      <input type="password" id="forceNewPinInput" class="text-center" placeholder="새 비밀번호 6자리 숫자" maxlength="6" style="height: 38px; font-size: 0.95rem; letter-spacing: 2px; margin-bottom: 8px;" onkeypress="if(event.keyCode===13){ document.getElementById('forceNewPinConfirmInput').focus(); }">
      <input type="password" id="forceNewPinConfirmInput" class="text-center" placeholder="새 비밀번호 6자리 다시 입력" maxlength="6" style="height: 38px; font-size: 0.95rem; letter-spacing: 2px; margin-bottom: 12px;" onkeypress="if(event.keyCode===13){ executeForceChangePin(); }">
      <div class="d-flex gap-2">
        <button type="button" class="btn btn-secondary btn-sm flex-fill py-2" style="font-size: 0.8rem; border-radius: 8px;" onclick="closeForceChangePinModal()">나중에 변경</button>
        <button type="button" class="btn btn-warning btn-sm flex-fill fw-bold py-2" style="background:#fee500; border:none; color:#191919; font-size: 0.8rem; border-radius: 8px;" onclick="executeForceChangePin()">변경 완료</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

window.openForceChangePinModal = function() {
  const modal = ensureForceChangePinModalExists();
  const in1 = document.getElementById("forceNewPinInput");
  const in2 = document.getElementById("forceNewPinConfirmInput");
  if (in1) in1.value = "";
  if (in2) in2.value = "";
  modal.style.display = "flex";
  setTimeout(() => {
    if (in1) in1.focus();
  }, 100);
};
var openForceChangePinModal = window.openForceChangePinModal;

window.closeForceChangePinModal = function() {
  const modal = document.getElementById("modalForceChangePin");
  if (modal) modal.style.display = "none";
};
var closeForceChangePinModal = window.closeForceChangePinModal;

window.executeForceChangePin = async function() {
  const in1 = document.getElementById("forceNewPinInput");
  const in2 = document.getElementById("forceNewPinConfirmInput");
  const newPin = (in1 ? in1.value : "").trim();
  const confirmPin = (in2 ? in2.value : "").trim();
  const myNick = localStorage.getItem("guild_my_nickname") || myCurrentNick || "";

  if (!newPin || newPin.length !== 6 || isNaN(Number(newPin))) {
    return showKakaoToast("새 비밀번호는 6자리 숫자로 입력해주세요.", "⚠️");
  }
  if (newPin === "000000" || newPin === "0000") {
    return showKakaoToast("초기 비밀번호(000000) 외의 다른 숫자로 입력해주세요.", "⚠️");
  }
  if (newPin !== confirmPin) {
    return showKakaoToast("입력하신 두 비밀번호가 일치하지 않습니다.", "❌");
  }

  try {
    if (typeof apiRequest === "function" && myNick) {
      try {
        await apiRequest(`guild_members?nickname=eq.${encodeURIComponent(myNick)}`, "PATCH", { pin: newPin });
      } catch(e) {}
      try {
        await apiRequest(`guild_members?name=eq.${encodeURIComponent(myNick)}`, "PATCH", { pin: newPin });
      } catch(e2) {}
    }

    myCurrentPin = newPin;
    localStorage.setItem("guild_my_pin", newPin);

    if (cachedMemberList && Array.isArray(cachedMemberList)) {
      const target = cachedMemberList.find(m => (m.nickname === myNick || m.name === myNick));
      if (target) target.pin = newPin;
    }

    closeForceChangePinModal();
    showKakaoToast("비밀번호가 성공적으로 변경되었습니다!", "🎉");
  } catch (err) {
    showKakaoToast("비밀번호 변경 실패: " + err.message, "❌");
  }
};
var executeForceChangePin = window.executeForceChangePin;

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
  }
  if (pinInput) pinInput.value = "";

  renderLoginMemberDropdown(searchInput ? searchInput.value : "");
  if (!cachedMemberList || cachedMemberList.length === 0) {
    window.loadGuildMembersData();
  }
}
window.showGuildLoginModal = showGuildLoginModal;

// [버그 수정 1]: 로그인 완료 시 이전 사용자의 말풍선 캐시를 클리어하고 초기 비밀번호(000000)이면 변경 모달 표시
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
    const loginModal = document.getElementById("guildLoginModal");
    if (loginModal) loginModal.style.display = "none";
    const welcomeModal = document.getElementById("modalWelcomeGateway");
    if (welcomeModal) welcomeModal.style.display = "none";
    document.querySelectorAll(".kakao-modal-backdrop").forEach(m => {
      m.style.display = "none";
    });
    const mainTabs = document.getElementById("kakaoMainTabsView");
    if (mainTabs) mainTabs.style.display = "flex";
    document.body.classList.add("in-main-tabs");
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
  
  // 모든 모달 닫기
  const loginModal = document.getElementById("guildLoginModal");
  if (loginModal) loginModal.style.display = "none";
  const welcomeModal = document.getElementById("modalWelcomeGateway");
  if (welcomeModal) welcomeModal.style.display = "none";
  document.querySelectorAll(".kakao-modal-backdrop").forEach(m => {
    m.style.display = "none";
  });

  // 메인 화면 활성화
  const mainTabs = document.getElementById("kakaoMainTabsView");
  if (mainTabs) mainTabs.style.display = "flex";
  document.body.classList.add("in-main-tabs");

  resetAndReloadChatAfterAuth();

  // ⚡ 초기 비밀번호(000000 또는 0000)로 로그인 시 비밀번호 변경 안내 모달 표시
  const isDefaultPin = (inputPin === "000000" || inputPin === "0000" || expectedPin === "000000" || expectedPin === "0000");
  if (isDefaultPin) {
    showKakaoToast("비밀번호를 변경하세요. (초기 비밀번호 사용 중)", "🔐");
    setTimeout(() => {
      openForceChangePinModal();
    }, 150);
  } else {
    showKakaoToast(`[${memberName}] 님 반갑습니다!`, "🎉");
  }
}

// ⚡ 로그아웃 시 "로그아웃 되었습니다." 안내 토스트 표시 후 로그인 창 오픈
function handleUserLogout() {
  if (typeof openConfirmLogoutModal === "function") {
    openConfirmLogoutModal();
    return;
  }
  executeLogoutProcess();
}
window.handleUserLogout = handleUserLogout;

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
  showKakaoToast("로그아웃 되었습니다.", "👋");
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
  document.querySelectorAll(".kakao-modal-backdrop").forEach(m => {
    if (m.id !== "modalForceChangePin") {
      m.style.display = "none";
    }
  });

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

  const mainTabs = document.getElementById("kakaoMainTabsView");
  if (mainTabs) mainTabs.style.display = "flex";
  document.body.classList.add("in-main-tabs");

  if (typeof window.switchMainBottomTab === "function") {
    window.switchMainBottomTab("chats");
  }
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
// 5. 과거 대화 로드 & 실시간 대화 수신 (방별 격리 & 노란색 읽음 계산)
// --------------------------------------------------------
async function loadPastChatMessages() {
  const isInChatView = (document.getElementById("chatRoomView") && document.getElementById("chatRoomView").style.display === "flex");
  const activeRoom = window.currentActiveRoomId;
  const chatContainer = document.getElementById("chatMessagesView");
  if (!chatContainer) return;

  // ⚡ 실제 대화방 화면에 진입하지 않았거나 activeRoom이 없으면 목록 화면에서 임의 실행 차단
  if (!isInChatView || !activeRoom) return;

  // 1) [대화 내역 사라짐 방지]: 로컬 캐시에서 먼저 즉시 복원하여 화면 깜빡임 및 빈 화면 방지
  const cacheKey = "chat_history_cache_" + activeRoom;
  let cachedMessages = [];
  try {
    cachedMessages = JSON.parse(sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey) || "[]");
  } catch(e) {}

  if ((!cachedMessages || cachedMessages.length === 0) && window.roomMsgMapCache && window.roomMsgMapCache.has(activeRoom)) {
    cachedMessages = window.roomMsgMapCache.get(activeRoom).slice().reverse();
  }

  if (cachedMessages && cachedMessages.length > 0) {
    renderMessageHistoryList(cachedMessages);
  } else {
    chatContainer.innerHTML = `
      <div class="text-center my-1">
        <span class="badge bg-secondary bg-opacity-25 text-secondary px-2 py-1" style="font-size:0.65rem;">대화가 안전하게 연결되었습니다.</span>
      </div>
    `;
  }

  // 2) 서버에서 최신 대화 목록 조회 및 방별 엄격한 격리 필터링
  try {
    const currentGid = localStorage.getItem("current_guild_id");
    let list = [];

    if (activeRoom !== "default_public") {
      if (currentGid) {
        try {
          list = await apiRequest(`guild_chats?guild_id=eq.${encodeURIComponent(currentGid)}&room_id=eq.${encodeURIComponent(activeRoom)}&select=*&order=id.desc&limit=150`);
        } catch (e) {}
      }
      if (!list || list.length === 0) {
        try {
          list = await apiRequest(`guild_chats?room_id=eq.${encodeURIComponent(activeRoom)}&select=*&order=id.desc&limit=150`);
        } catch (e2) {}
      }
    } else {
      if (currentGid) {
        try {
          list = await apiRequest(`guild_chats?guild_id=eq.${encodeURIComponent(currentGid)}&select=*&order=id.desc&limit=150`);
        } catch (e) {}
      }
    }

    if (!list || list.length === 0) {
      try {
        list = await apiRequest("guild_chats?select=*&order=id.desc&limit=150");
      } catch (err2) {
        console.warn("Server chat fetch fallback failed:", err2);
      }
    }

    // 3) [방 격리 보장]: 1:1 대화 내용이 단체 대화방에 절대 노출되지 않도록 필터링 (레거시 ID 포함)
    let filtered = (list || []).filter(c => {
      let rId = (!c.room_id || c.room_id === "default_public" || c.room_id === "public") ? "default_public" : c.room_id;
      if (rId && rId.startsWith("direct_") && typeof window.generateDeterministicUUID === "function") {
        const clean = rId.replace("direct_", "").replace("direct__", "");
        const parts = clean.split("__");
        if (parts.length === 2) {
          const sorted = [parts[0], parts[1]].sort();
          rId = window.generateDeterministicUUID("direct__" + sorted[0] + "__" + sorted[1]);
        }
      }
      return rId === activeRoom;
    });

    // 캐시와 병합하여 중복 제거 (id 기준)
    const mergedMap = new Map();
    (cachedMessages || []).forEach(m => { if (m && m.id) mergedMap.set(String(m.id), m); });
    filtered.forEach(m => { if (m && m.id) mergedMap.set(String(m.id), m); });

    const finalSorted = Array.from(mergedMap.values()).sort((a, b) => {
      const tA = new Date(a.created_at || 0).getTime() || 0;
      const tB = new Date(b.created_at || 0).getTime() || 0;
      if (tA !== tB) return tA - tB;
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });

    if (finalSorted.length > 0) {
      // 캐시 갱신
      try {
        localStorage.setItem(cacheKey, JSON.stringify(finalSorted.slice(-100)));
        sessionStorage.setItem(cacheKey, JSON.stringify(finalSorted.slice(-100)));
      } catch(e) {}

      // ⚡ 현재 방의 최신 메시지 읽음 상태 완벽 저장
      if (typeof window.markRoomAsReadNow === "function") {
        window.markRoomAsReadNow(activeRoom, finalSorted);
      } else {
        const numericIds = finalSorted.map(m => parseInt(m.id, 10)).filter(n => !isNaN(n) && n > 0);
        if (numericIds.length > 0) {
          localStorage.setItem("last_read_chat_id_" + activeRoom, String(Math.max(...numericIds)));
        }
      }

      renderMessageHistoryList(finalSorted);
      syncMyReadStatusToServer(finalSorted);
    }
  } catch (e) {
    console.warn("loadPastChatMessages error:", e);
  }
}

// ⚡ 내가 확인한 메시지의 read_members 배열에 내 닉네임을 서버 DB에 반영하여 노란색 숫자가 실시간 차감되도록 동기화
async function syncMyReadStatusToServer(msgList) {
  if (!myCurrentNick || !Array.isArray(msgList) || msgList.length === 0) return;

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
      await apiRequest(`guild_chats?id=eq.${encodeURIComponent(m.id)}`, "PATCH", {
        read_members: updatedArr
      });
    } catch (e) {
      break;
    }
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

  // 이후에 대화를 작성한 사람은 이전 메시지를 모두 읽은 것으로 자동 집계
  const subsequentSenders = new Set();
  for (let i = msgList.length - 1; i >= 0; i--) {
    const msg = msgList[i];
    if (!msg) continue;
    const baseReaders = new Set(Array.isArray(msg.read_members) ? msg.read_members : []);
    if (msg.sender_name) baseReaders.add(msg.sender_name);
    if (myCurrentNick) baseReaders.add(myCurrentNick);
    subsequentSenders.forEach(s => baseReaders.add(s));
    msg._computedReaders = Array.from(baseReaders);
    if (msg.sender_name) subsequentSenders.add(msg.sender_name);
  }

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

function listenRealtimeChatMessages() {
  if (!supabaseClient) return;

  supabaseClient
    .channel("public:guild_chats")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "guild_chats" }, (payload) => {
      if (!payload.new) return;
      const newMsg = payload.new;
      const activeRoom = window.currentActiveRoomId;
      const msgRoom = (!newMsg.room_id || newMsg.room_id === "public" || newMsg.room_id === "default_public") ? "default_public" : newMsg.room_id;

      // ⚡ 대화방 목록 미리보기 텍스트 및 붉은색 안 읽은 메시지 뱃지 실시간 갱신
      if (typeof window.updateRoomCardRealtime === "function") {
        window.updateRoomCardRealtime(msgRoom, newMsg);
      }

      // 1) 해당 방의 로컬 캐시 실시간 업데이트 (뒤로가기 후 재입장 시 대화 보존)
      try {
        const cacheKey = "chat_history_cache_" + msgRoom;
        let localMsgs = JSON.parse(sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey) || "[]");
        if (!localMsgs.find(m => String(m.id) === String(newMsg.id))) {
          localMsgs.push(newMsg);
          sessionStorage.setItem(cacheKey, JSON.stringify(localMsgs.slice(-100)));
          localStorage.setItem(cacheKey, JSON.stringify(localMsgs.slice(-100)));
        }
      } catch(e) {}

      // 2) [방별 격리]: 실제 대화방 화면 안에 있고 현재 방과 일치할 때만 말풍선 렌더링
      const isInChatView = (document.getElementById("chatRoomView") && document.getElementById("chatRoomView").style.display === "flex");
      if (!isInChatView || !activeRoom) return;

      if (activeRoom === "default_public") {
        if (newMsg.room_id && newMsg.room_id !== "default_public" && newMsg.room_id !== "public") {
          return; // 1:1 대화방 메시지는 전체 대화방에 절대 섞이지 않음
        }
      } else {
        if (newMsg.room_id !== activeRoom) {
          return; // 다른 방 메시지는 메인 대화창에 섞이지 않음
        }
      }

      // 상대방이 새 메시지를 보냈다면 이전 내 메시지들은 상대방이 읽은 것이므로 노란 숫자 갱신
      if (newMsg.sender_name && newMsg.sender_name !== myCurrentNick) {
        const isDirect = (window.currentActiveRoomType === "direct") || (activeRoom && activeRoom !== "default_public" && activeRoom.includes("-"));
        if (isDirect) {
          document.querySelectorAll("#chatMessagesView .chat-unread-count").forEach(el => {
            el.innerText = "";
            el.style.display = "none";
          });
        }
        syncMyReadStatusToServer([newMsg]);
      }

      // 3) 내가 전송한 낙관적 메시지 중복 방어
      const optimisticIdx = pendingOptimisticMessages.findIndex(m => 
        m.sender_name === newMsg.sender_name && (m.message === newMsg.message || m.message === newMsg.message_text)
      );
      if (optimisticIdx !== -1) {
        pendingOptimisticMessages.splice(optimisticIdx, 1);
        return;
      }

      const isConsecutive = (newMsg.sender_name === lastRenderedSender && newMsg.msg_type === "chat");
      renderKakaoChatBubble(newMsg, true, isConsecutive);
      lastRenderedSender = (newMsg.msg_type === "chat") ? newMsg.sender_name : null;
      scrollChatBottom();
      if (typeof window.syncAllChatCutButtons === "function") window.syncAllChatCutButtons();
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "guild_chats" }, (payload) => {
      if (!payload.new || !payload.new.id) return;
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

// --------------------------------------------------------
// 6. 카카오톡 말풍선 렌더링 (노란색 읽음 숫자 & 나/상대방 완벽 분리)
// --------------------------------------------------------
function renderKakaoChatBubble(msg, doScroll = true, isConsecutive = false) {
  const container = document.getElementById("chatMessagesView");
  if (!container) return;

  const isMe = (myCurrentNick && (msg.sender_name === myCurrentNick));
  const isMentioned = Array.isArray(msg.mentions) && msg.mentions.includes(myCurrentNick);
  const msgKey = msg.id ? ("msg_" + msg.id) : ("msg_tmp_" + Math.floor(Math.random() * 10000000));
  const timeStr = formatKSTChatTime(msg.created_at);

  // ⚡ [노란색 안 읽은 숫자 정밀 계산]:
  // 작성자 본인(sender_name)과 현재 대화방을 열어 보고 있는 나(myCurrentNick)는 항상 읽은 사람(readerSet)에 포함!
  const activeRoom = window.currentActiveRoomId || "default_public";
  const isDirect = (window.currentActiveRoomType === "direct") || 
                   (activeRoom && (activeRoom.startsWith("direct_") || (activeRoom.includes("-") && activeRoom !== "default_public"))) ||
                   (msg.room_id && (msg.room_id.startsWith("direct_") || (msg.room_id.includes("-") && msg.room_id !== "default_public")));
  const totalMembers = isDirect ? 2 : ((cachedMemberList && cachedMemberList.length > 0) ? cachedMemberList.length : 2);

  const readerSet = new Set();
  if (Array.isArray(msg._computedReaders)) {
    msg._computedReaders.forEach(r => { if (r) readerSet.add(r); });
  }
  if (Array.isArray(msg.read_members)) {
    msg.read_members.forEach(r => { if (r) readerSet.add(r); });
  }
  if (msg.sender_name) readerSet.add(msg.sender_name);
  if (myCurrentNick) readerSet.add(myCurrentNick);

  let unreadCount = 0;
  if (isDirect) {
    // 1:1 대화방 (총 2명):
    // - 상대방이 쓴 글(!isMe)은 내가 지금 보고 있으므로 나+상대방 모두 읽음 -> 무조건 0 (숨김)
    // - 내가 쓴 글(isMe)은 내가 읽었으므로 최대 1, 상대방도 읽었으면(readerSet.size >= 2) 0
    if (!isMe) {
      unreadCount = 0;
    } else {
      unreadCount = (readerSet.size >= 2) ? 0 : 1;
    }
  } else {
    // 전체/그룹 대화방: 총 인원에서 읽은 인원(작성자 + 현재 열람 중인 나 + read_members) 차감
    unreadCount = Math.max(0, totalMembers - readerSet.size);
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
  // 5) 상대방이 작성한 메시지 (어두운/흰색 말풍선 좌측 정렬)
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
// 7. 메시지 입력 및 전송 제어
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

  const activeRoomKey = window.currentActiveRoomId || "default_public";
  const isPublicRoom = (activeRoomKey === "default_public" || activeRoomKey === "public");
  const targetRoomId = isPublicRoom ? null : activeRoomKey;
  const tempId = "tmp_" + Date.now();
  const optimisticMsg = {
    id: tempId,
    room_id: targetRoomId,
    sender_name: myCurrentNick,
    message: text,
    msg_type: "chat",
    mentions: detectedMentions,
    read_members: [myCurrentNick],
    created_at: new Date().toISOString()
  };

  pendingOptimisticMessages.push(optimisticMsg);
  const isConsecutive = (myCurrentNick === lastRenderedSender);
  renderKakaoChatBubble(optimisticMsg, true, isConsecutive);
  scrollChatBottom();
  lastRenderedSender = myCurrentNick;

  // 로컬 캐시에도 즉시 저장하여 나갔다 들어와도 대화 증발 방지
  try {
    const cacheKey = "chat_history_cache_" + activeRoomKey;
    let localMsgs = JSON.parse(sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey) || "[]");
    localMsgs.push(optimisticMsg);
    sessionStorage.setItem(cacheKey, JSON.stringify(localMsgs.slice(-100)));
    localStorage.setItem(cacheKey, JSON.stringify(localMsgs.slice(-100)));
  } catch(e) {}

  try {
    const currentGid = localStorage.getItem("current_guild_id");

    // 1:1 또는 커스텀 대화방인 경우 chat_rooms에 해당 UUID 방이 존재하는지 보장 (외래키 에러 원천 차단)
    if (targetRoomId) {
      try {
        const existRoom = await apiRequest(`chat_rooms?id=eq.${encodeURIComponent(targetRoomId)}&select=id`);
        if (!existRoom || existRoom.length === 0) {
          const roomPayload = {
            id: targetRoomId,
            room_name: window.currentActiveRoomTitle || "1:1 대화방",
            room_type: window.currentActiveRoomType || "direct",
            created_by: myCurrentNick
          };
          if (currentGid) roomPayload.guild_id = currentGid;
          await apiRequest("chat_rooms", "POST", [roomPayload]);
        }
      } catch (roomCheckErr) {}
    }

    const chatPayload = {
      sender_name: myCurrentNick,
      message: text,
      msg_type: "chat",
      mentions: detectedMentions,
      read_members: [myCurrentNick]
    };
    if (targetRoomId) chatPayload.room_id = targetRoomId;
    if (currentGid) chatPayload.guild_id = currentGid;

    let insertRes;
    try {
      insertRes = await apiRequest("guild_chats", "POST", [chatPayload]);
    } catch (postErr1) {
      // read_members 또는 guild_id 호환성 폴백
      const fallbackPayload1 = {
        sender_name: myCurrentNick,
        message: text,
        msg_type: "chat"
      };
      if (targetRoomId) fallbackPayload1.room_id = targetRoomId;
      try {
        insertRes = await apiRequest("guild_chats", "POST", [fallbackPayload1]);
      } catch (postErr2) {
        const minimalPayload = {
          sender_name: myCurrentNick,
          message: text,
          msg_type: "chat"
        };
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
    }

    if (insertRes && insertRes[0] && insertRes[0].id) {
      const realId = insertRes[0].id;
      const rowElem = document.getElementById("msg_" + tempId);
      if (rowElem) {
        rowElem.id = "msg_" + realId;
        rowElem.setAttribute("data-msg-id", realId);
      }
      // 캐시 ID도 실제 서버 ID로 업데이트 및 읽음 상태 갱신
      try {
        const cacheKey = "chat_history_cache_" + activeRoomKey;
        let localMsgs = JSON.parse(sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey) || "[]");
        const target = localMsgs.find(m => m.id === tempId);
        if (target) target.id = realId;
        sessionStorage.setItem(cacheKey, JSON.stringify(localMsgs));
        localStorage.setItem(cacheKey, JSON.stringify(localMsgs));
        if (typeof window.markRoomAsReadNow === "function") {
          window.markRoomAsReadNow(activeRoomKey, localMsgs);
        }
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
// 10. 대화 검색 및 기타 유틸
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
