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
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  return formatter.format(d);
}

function formatDateDivider(dateInput) {
  if (!dateInput) return "";
  let d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) d = new Date();

  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dayName = days[d.getDay()];
  return `${y}년 ${m}월 ${day}일 ${dayName}요일`;
}

// --------------------------------------------------------
// 2. 초기화 및 세션 관리
// --------------------------------------------------------
async function initApp() {
  initTheme();
  setupPwaInstallation();

  // Supabase 클라이언트 확인
  if (window.supabase) {
    supabaseClient = window.supabaseClient || window.supabase;
  }

  // 로그인 상태 동기화
  syncUserSessionUI();

  // 초기 길드원 목록 및 공지사항 캐싱
  await fetchGuildMembers();
  initGuildNoticeRealtime();

  // 실시간 채팅 리스너 연결
  initChatRealtime();

  // 과거 대화 기록 불러오기
  loadPastChatMessages();

  // 멘션 팝업 이벤트 바인딩
  bindMentionInputEvents();
}

function syncUserSessionUI() {
  myCurrentNick = localStorage.getItem("guild_my_nickname") || "";
  myCurrentAvatar = localStorage.getItem("guild_my_avatar") || "👤";
  myCurrentClass = localStorage.getItem("guild_my_class") || "직업 설정하기";

  const nickElem = document.getElementById("drawerMyNick");
  const avatarElem = document.getElementById("drawerMyAvatar");
  const classElem = document.getElementById("drawerMyClass");

  if (nickElem) nickElem.innerText = myCurrentNick || "로그인 필요";
  if (avatarElem) avatarElem.innerText = myCurrentAvatar;
  if (classElem) classElem.innerText = myCurrentClass;

  const btnLogin = document.getElementById("btnDrawerLogin");
  const btnLogout = document.getElementById("btnDrawerLogout");
  if (myCurrentNick) {
    if (btnLogin) btnLogin.style.display = "none";
    if (btnLogout) btnLogout.style.display = "block";
  } else {
    if (btnLogin) btnLogin.style.display = "block";
    if (btnLogout) btnLogout.style.display = "none";
  }
}

// --------------------------------------------------------
// 3. 길드원 목록 불러오기 & 멘션용 캐싱
// --------------------------------------------------------
async function fetchGuildMembers() {
  try {
    const currentGid = localStorage.getItem("current_guild_id");
    let members = [];

    if (typeof apiRequest === "function") {
      try {
        if (currentGid) {
          members = await apiRequest("guild_members?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*&order=nickname.asc");
        }
      } catch(e) {
        try {
          members = await apiRequest("guild_members?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*&order=name.asc");
        } catch(e2) {}
      }

      if (!members || members.length === 0) {
        if (!currentGid) {
          members = await apiRequest("guild_members?select=*&order=nickname.asc");
        }
      }
    }

    cachedMemberList = members || [];
    window.cachedMemberList = cachedMemberList;
  } catch (err) {
    console.warn("Guild members load warning:", err);
  }
}

// --------------------------------------------------------
// 4. 공지사항 배너 접기/펼치기 & 실시간 구독
// --------------------------------------------------------
function toggleKakaoNoticeBanner() {
  const banner = document.getElementById("kakaoNoticeBanner");
  if (!banner) return;
  banner.classList.toggle("expanded");
}

async function initGuildNoticeRealtime() {
  const summaryElem = document.getElementById("noticeSummaryText");
  const detailElem = document.getElementById("noticeDetailBody");

  try {
    const currentGid = localStorage.getItem("current_guild_id");
    let query = "guild_notices?order=created_at.desc&limit=1";
    if (currentGid) query += `&guild_id=eq.${encodeURIComponent(currentGid)}`;

    if (typeof apiRequest === "function") {
      const notices = await apiRequest(query);
      if (notices && notices.length > 0) {
        const n = notices[0];
        if (summaryElem) summaryElem.innerText = n.title || "등록된 공지사항이 있습니다.";
        if (detailElem) detailElem.innerText = n.content || "공지사항 상세 내용이 없습니다.";
      } else {
        if (summaryElem) summaryElem.innerText = "등록된 길드 공지사항이 없습니다.";
        if (detailElem) detailElem.innerText = "상단 관리자 메뉴에서 새로운 공지를 등록해 보세요.";
      }
    }
  } catch (e) {
    if (summaryElem) summaryElem.innerText = "공지사항을 불러오는 중...";
  }

  if (supabaseClient) {
    try {
      supabaseClient
        .channel("public:guild_notices")
        .on("postgres_changes", { event: "*", schema: "public", table: "guild_notices" }, async () => {
          initGuildNoticeRealtime();
        })
        .subscribe();
    } catch(e) {}
  }
}

// --------------------------------------------------------
// 5. 과거 채팅 내역 로딩 및 렌더링
// --------------------------------------------------------
async function loadPastChatMessages() {
  const scroller = document.getElementById("kakaoChatScroller");
  if (!scroller) return;

  const activeRoomId = window.currentActiveRoomId || null;
  scroller.innerHTML = `<div class="text-center py-3 text-secondary small"><i class="fa-solid fa-spinner fa-spin me-2"></i>대화 내역을 불러오는 중...</div>`;

  try {
    let query = "guild_chats?order=created_at.asc&limit=100";
    if (activeRoomId && activeRoomId !== "default_public") {
      query += `&room_id=eq.${encodeURIComponent(activeRoomId)}`;
    } else {
      query += `&or=(room_id.is.null,room_id.eq.default_public)`;
    }

    let messages = [];
    if (typeof apiRequest === "function") {
      messages = await apiRequest(query);
    }

    scroller.innerHTML = "";
    lastRenderedSender = null;
    let lastRenderedDate = null;

    if (!messages || messages.length === 0) {
      scroller.innerHTML = `
        <div class="kakao-date-divider">
          <span class="date-divider-pill">${formatDateDivider(new Date())}</span>
        </div>
        <div class="chat-bubble-row system">
          <div class="system-msg-pill">대화방이 개설되었습니다. 자유롭게 대화를 시작해 보세요!</div>
        </div>
      `;
      return;
    }

    messages.forEach(msg => {
      const msgDate = new Date(msg.created_at);
      const dateStr = formatDateDivider(msgDate);

      if (dateStr !== lastRenderedDate) {
        renderDateDivider(dateStr);
        lastRenderedDate = dateStr;
        lastRenderedSender = null;
      }

      const isConsecutive = (msg.sender_name === lastRenderedSender);
      renderKakaoChatBubble(msg, false, isConsecutive);
      lastRenderedSender = msg.sender_name;
    });

    scrollChatToBottom();
  } catch (err) {
    console.error("Chat load error:", err);
    scroller.innerHTML = `<div class="text-center py-3 text-danger small">대화 내역을 불러오지 못했습니다.</div>`;
  }
}

function renderDateDivider(dateText) {
  const scroller = document.getElementById("kakaoChatScroller");
  if (!scroller) return;
  const div = document.createElement("div");
  div.className = "kakao-date-divider";
  div.innerHTML = `<span class="date-divider-pill">${dateText}</span>`;
  scroller.appendChild(div);
}

// --------------------------------------------------------
// 6. 카카오톡 말풍선 렌더러 (일반 대화 / 보고서 카드 / 시스템 알림)
// --------------------------------------------------------
function renderKakaoChatBubble(msg, isRealtime = false, isConsecutive = false) {
  const scroller = document.getElementById("kakaoChatScroller");
  if (!scroller) return;

  const isMine = (msg.sender_name === myCurrentNick && myCurrentNick !== "");
  const timeText = formatTime24Hour(msg.created_at);

  // 시스템 메시지 처리
  if (msg.msg_type === "system" || msg.sender_name === "SYSTEM") {
    const sysRow = document.createElement("div");
    sysRow.className = "chat-bubble-row system";
    sysRow.id = "msg_" + (msg.id || Date.now());
    sysRow.innerHTML = `<div class="system-msg-pill">${escapeHtml(msg.message)}</div>`;
    scroller.appendChild(sysRow);
    if (isRealtime) scrollChatToBottom();
    return;
  }

  // 정품 알리미 보고서 카드 처리 (records_report, finance_report 등)
  if (msg.msg_type === "records_report" || msg.msg_type === "finance_report" || (msg.message && msg.message.includes("records-report-card"))) {
    const cardRow = document.createElement("div");
    cardRow.className = `chat-bubble-row ${isMine ? "mine" : "other"}`;
    cardRow.id = "msg_" + (msg.id || Date.now());

    let avatarHtml = "";
    let senderHtml = "";
    if (!isMine) {
      const senderAvatar = getMemberAvatar(msg.sender_name);
      avatarHtml = `<div class="msg-avatar">${senderAvatar}</div>`;
      senderHtml = `<div class="msg-sender-name">${escapeHtml(msg.sender_name)}</div>`;
    }

    cardRow.innerHTML = `
      ${avatarHtml}
      <div class="msg-body-col">
        ${senderHtml}
        <div class="msg-content-line">
          ${isMine ? `<div class="msg-meta-col"><span class="msg-time-stamp">${timeText}</span></div>` : ""}
          <div class="report-card-container">${msg.message}</div>
          ${!isMine ? `<div class="msg-meta-col"><span class="msg-time-stamp">${timeText}</span></div>` : ""}
        </div>
      </div>
    `;
    scroller.appendChild(cardRow);
    if (isRealtime) scrollChatToBottom();
    return;
  }

  // 일반 채팅 말풍선 처리
  const row = document.createElement("div");
  row.className = `chat-bubble-row ${isMine ? "mine" : "other"} ${isConsecutive ? "consecutive" : ""}`;
  row.id = "msg_" + (msg.id || Date.now());
  row.setAttribute("data-sender", msg.sender_name || "");

  // 멘션 하이라이트 및 텍스트 이스케이프
  let formattedText = escapeHtml(msg.message || "");
  if (msg.mentions && Array.isArray(msg.mentions)) {
    msg.mentions.forEach(m => {
      const mentionRegex = new RegExp(`@${m}\\b`, "g");
      const isMeMentioned = (m === myCurrentNick);
      formattedText = formattedText.replace(mentionRegex, `<span class="badge ${isMeMentioned ? 'bg-warning text-dark font-weight-bold' : 'bg-primary bg-opacity-25 text-primary'}">@${m}</span>`);
    });
  }

  if (isMine) {
    row.innerHTML = `
      <div class="msg-content-line">
        <div class="msg-meta-col">
          <span class="msg-time-stamp">${timeText}</span>
        </div>
        <div class="msg-bubble">${formattedText}</div>
      </div>
    `;
  } else {
    const senderAvatar = getMemberAvatar(msg.sender_name);
    row.innerHTML = `
      ${!isConsecutive ? `<div class="msg-avatar">${senderAvatar}</div>` : `<div class="msg-avatar" style="visibility:hidden;"></div>`}
      <div class="msg-body-col">
        ${!isConsecutive ? `<div class="msg-sender-name">${escapeHtml(msg.sender_name)}</div>` : ""}
        <div class="msg-content-line">
          <div class="msg-bubble">${formattedText}</div>
          <div class="msg-meta-col">
            <span class="msg-time-stamp">${timeText}</span>
          </div>
        </div>
      </div>
    `;
  }

  scroller.appendChild(row);
  if (isRealtime) scrollChatToBottom();
}

function getMemberAvatar(nick) {
  if (!nick) return "👤";
  const m = (cachedMemberList || []).find(mem => (mem.nickname === nick || mem.name === nick));
  return (m && (m.avatar_icon || m.avatar)) ? (m.avatar_icon || m.avatar) : "👤";
}

function scrollChatToBottom() {
  const scroller = document.getElementById("kakaoChatScroller");
  if (!scroller) return;
  setTimeout(() => {
    scroller.scrollTop = scroller.scrollHeight;
  }, 30);
}

// --------------------------------------------------------
// 7. 실시간 메시지 전송 로직 (Enter키 & 전송 버튼 핵심 바인딩)
// --------------------------------------------------------
function handleChatInputKeydown(event) {
  if (event.key === "Enter" && !event.shiftKey) {
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

  const targetRoomId = window.currentActiveRoomId || null;
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
  renderKakaoChatBubble(optimisticMsg, false, isConsecutive);
  lastRenderedSender = myCurrentNick;

  try {
    const insertRes = await apiRequest("guild_chats", "POST", [{
      room_id: targetRoomId,
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

    if (atIdx !== -1 && (atIdx === 0 || /\s/.test(beforeText[atIdx - 1]))) {
      const searchKw = beforeText.slice(atIdx + 1).toLowerCase();
      const filtered = (cachedMemberList || []).filter(m => {
        const name = (m.nickname || m.name || "").toLowerCase();
        return name.includes(searchKw);
      });

      if (filtered.length > 0) {
        popup.innerHTML = filtered.map(m => {
          const name = m.nickname || m.name;
          const av = m.avatar_icon || m.avatar || "👤";
          return `
            <div class="mention-item d-flex align-items-center gap-2 p-2 border-bottom" style="cursor:pointer;" onclick="selectMentionMember('${name}')">
              <span>${av}</span>
              <span class="small font-weight-bold">${name}</span>
            </div>
          `;
        }).join("");
        popup.style.display = "block";
        return;
      }
    }
    popup.style.display = "none";
  });
}

function selectMentionMember(name) {
  const input = document.getElementById("inputChatMessage");
  const popup = document.getElementById("mentionPopupBox");
  if (!input) return;

  const val = input.value;
  const cursorPos = input.selectionStart;
  const beforeText = val.slice(0, cursorPos);
  const afterText = val.slice(cursorPos);
  const atIdx = beforeText.lastIndexOf("@");

  if (atIdx !== -1) {
    input.value = beforeText.slice(0, atIdx) + `@${name} ` + afterText;
    input.focus();
  }
  if (popup) popup.style.display = "none";
}

// --------------------------------------------------------
// 9. Supabase 실시간 채팅 구독 (Realtime Stream)
// --------------------------------------------------------
function initChatRealtime() {
  if (!supabaseClient) return;

  try {
    supabaseClient
      .channel("public:guild_chats")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "guild_chats" }, (payload) => {
        const newMsg = payload.new;
        if (!newMsg) return;

        // 현재 열려 있는 방과 일치하는지 확인
        const activeRoom = window.currentActiveRoomId || null;
        if (activeRoom && activeRoom !== "default_public") {
          if (newMsg.room_id !== activeRoom) return;
        } else {
          if (newMsg.room_id && newMsg.room_id !== "default_public") return;
        }

        // 내가 보낸 낙관적 메시지와 중복 방지
        const pendingIdx = pendingOptimisticMessages.findIndex(m => m.message === newMsg.message && m.sender_name === newMsg.sender_name);
        if (pendingIdx !== -1) {
          pendingOptimisticMessages.splice(pendingIdx, 1);
          return;
        }

        const isConsecutive = (newMsg.sender_name === lastRenderedSender);
        renderKakaoChatBubble(newMsg, true, isConsecutive);
        lastRenderedSender = newMsg.sender_name;
      })
      .subscribe();
  } catch (err) {
    console.warn("Realtime chat subscription failed:", err);
  }
}

// --------------------------------------------------------
// 10. 기타 드로어 메뉴 & 편의 기능 모듈 로더
// --------------------------------------------------------
function openKakaoDrawer() {
  const overlay = document.getElementById("kakaoDrawerOverlay");
  if (overlay) overlay.classList.add("active");
  syncUserSessionUI();
}

function closeKakaoDrawer() {
  const overlay = document.getElementById("kakaoDrawerOverlay");
  if (overlay) overlay.classList.remove("active");
}

function handleInputState(input) {
  const sendBtn = document.getElementById("btnKakaoSend");
  if (!sendBtn) return;
  if (input.value.trim().length > 0) {
    sendBtn.removeAttribute("disabled");
  } else {
    sendBtn.setAttribute("disabled", "true");
  }
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

function initTheme() {
  const saved = localStorage.getItem("app_theme") || "dark";
  if (saved === "light") {
    document.documentElement.classList.remove("theme-dark");
    document.body.classList.remove("theme-dark");
  } else {
    document.documentElement.classList.add("theme-dark");
    document.body.classList.add("theme-dark");
  }
}

function toggleTheme() {
  const isDark = document.body.classList.contains("theme-dark");
  if (isDark) {
    document.documentElement.classList.remove("theme-dark");
    document.body.classList.remove("theme-dark");
    localStorage.setItem("app_theme", "light");
    showKakaoToast("라이트 모드로 전환되었습니다.", "☀️");
  } else {
    document.documentElement.classList.add("theme-dark");
    document.body.classList.add("theme-dark");
    localStorage.setItem("app_theme", "dark");
    showKakaoToast("다크 모드로 전환되었습니다.", "🌙");
  }
}

// --------------------------------------------------------
// 11. 대화방 내부 검색 기능 바인딩
// --------------------------------------------------------
window.toggleChatSearchBar = function() {
  const bar = document.getElementById("chatSearchBarWrap");
  if (!bar) return;
  bar.classList.toggle("d-none");
  if (!bar.classList.contains("d-none")) {
    const input = document.getElementById("chatSearchKeywordInput");
    if (input) input.focus();
  }
};

window.handleSearchChatMessages = function(keyword) {
  const scroller = document.getElementById("kakaoChatScroller");
  if (!scroller) return;

  const rows = scroller.querySelectorAll(".chat-bubble-row");
  let matchCount = 0;
  keyword = (keyword || "").trim().toLowerCase();

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
