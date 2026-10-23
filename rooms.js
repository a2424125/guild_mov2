// ========================================================
// [길드톡 메신저] 카카오톡 스타일 메인 3탭 & 다중 톡방 관리 모듈 (rooms.js)
// 친구 목록 / 대화방 목록 / 개인설정 탭 제어 및 방 개설(운영진방, 1:1 개인톡)
// ========================================================

// ⚡ [표준 UUID 결정론적 생성기]: 두 사람의 닉네임으로 항상 동일한 정식 UUID(36자리) 생성
function generateDeterministicUUID(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57, h3 = 0x67452301, h4 = 0xefcdab89;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ (ch >> 8), 1597334677);
    h3 = Math.imul(h3 ^ ch, 3812015801);
    h4 = Math.imul(h4 ^ (ch >> 4), 2246822507);
  }
  h1 = (h1 ^ (h1 >>> 16)) >>> 0;
  h2 = (h2 ^ (h2 >>> 16)) >>> 0;
  h3 = (h3 ^ (h3 >>> 16)) >>> 0;
  h4 = (h4 ^ (h4 >>> 16)) >>> 0;

  const hex = (
    h1.toString(16).padStart(8, '0') +
    h2.toString(16).padStart(8, '0') +
    h3.toString(16).padStart(8, '0') +
    h4.toString(16).padStart(8, '0')
  ).toLowerCase();

  const part1 = hex.substring(0, 8);
  const part2 = hex.substring(8, 12);
  const part3 = '5' + hex.substring(13, 16);
  const part4 = ((parseInt(hex.substring(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + hex.substring(18, 20);
  const part5 = hex.substring(20, 32);

  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}
window.generateDeterministicUUID = generateDeterministicUUID;

window.currentActiveRoomId = null;
window.currentActiveRoomType = "public";
window.currentActiveRoomTitle = "";
window.cachedChatRoomsList = [];

// --------------------------------------------------------
// 1. 하단 3탭 전환 제어 (친구 / 채팅 / 설정)
// --------------------------------------------------------
window.switchMainBottomTab = function(tabName) {
  const tabFriends = document.getElementById("tabFriendsContent");
  const tabChats = document.getElementById("tabChatRoomsContent");
  const tabMore = document.getElementById("tabMoreContent");

  const navFriends = document.getElementById("tabItemFriends") || document.getElementById("navTabFriends");
  const navChats = document.getElementById("tabItemChats") || document.getElementById("navTabChats");
  const navMore = document.getElementById("tabItemMore") || document.getElementById("navTabMore");

  const headerTitle = document.getElementById("mainTabHeaderTitle");
  const headerSubtitle = document.getElementById("mainTabHeaderSubtitle");
  const btnCreateRoom = document.getElementById("btnOpenCreateRoomModal");

  // 네비게이션 활성화 클래스 리셋
  if (navFriends) navFriends.classList.remove("active");
  if (navChats) navChats.classList.remove("active");
  if (navMore) navMore.classList.remove("active");

  // 탭 본문 숨김
  if (tabFriends) tabFriends.style.display = "none";
  if (tabChats) tabChats.style.display = "none";
  if (tabMore) tabMore.style.display = "none";

  if (tabName === "friends") {
    if (navFriends) navFriends.classList.add("active");
    if (tabFriends) tabFriends.style.display = "block";
    if (headerTitle) headerTitle.innerText = "친구";
    if (headerSubtitle) headerSubtitle.innerText = "";
    if (btnCreateRoom) btnCreateRoom.style.display = "none";
    loadMainTabFriendsList();
  } else if (tabName === "more" || tabName === "settings") {
    if (navMore) navMore.classList.add("active");
    if (tabMore) tabMore.style.display = "block";
    if (headerTitle) headerTitle.innerText = "설정";
    if (headerSubtitle) headerSubtitle.innerText = "";
    if (btnCreateRoom) btnCreateRoom.style.display = "none";
    loadMainTabSettingsPage();
  } else {
    // 기본값: 채팅 탭
    if (navChats) navChats.classList.add("active");
    if (tabChats) tabChats.style.display = "block";
    if (headerTitle) headerTitle.innerText = "대화방";
    if (headerSubtitle) headerSubtitle.innerText = "";
    if (btnCreateRoom) btnCreateRoom.style.display = "inline-flex";
    loadMainTabRoomsList();
  }
};

// --------------------------------------------------------
// 2. 친구 목록 로드 (친구 탭)
// --------------------------------------------------------
window.loadMainTabFriendsList = async function() {
  const container = document.getElementById("mainTabFriendsList");
  if (!container) return;

  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");
  const currentGid = localStorage.getItem("current_guild_id");

  try {
    let members = window.cachedMemberList || [];
    if (!members || members.length === 0) {
      if (typeof apiRequest === "function") {
        if (currentGid) {
          try {
            members = await apiRequest("guild_members?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*&order=name.asc");
          } catch(e) {}
        }
        if (!members || members.length === 0) {
          members = await apiRequest("guild_members?select=*&order=name.asc");
        }
      }
      window.cachedMemberList = members || [];
    }

    const countElem = document.getElementById("mainTabMemberCount");
    if (countElem) countElem.innerText = members.length;

    if (!members || members.length === 0) {
      container.innerHTML = `<div class="text-center py-5 text-secondary small">등록된 길드원이 없습니다.</div>`;
      return;
    }

    // 직책순 정렬: 길드장(1) -> 부길드장(2) -> 정예(3) -> 일반(4)
    const sorted = [...members].sort((a, b) => {
      const getPrio = r => {
        r = String(r || '').trim();
        if (r === '길드장' || r === '길마') return 1;
        if (r === '부길드장' || r === '부길마') return 2;
        if (r === '정예') return 3;
        return 4;
      };
      const pDiff = getPrio(a.role) - getPrio(b.role);
      if (pDiff !== 0) return pDiff;
      const nA = a.name || a.nickname || "";
      const nB = b.name || b.nickname || "";
      return nA.localeCompare(nB, 'ko');
    });

    container.innerHTML = sorted.map(m => {
      const mName = m.name || m.nickname || "길드원";
      const isMe = (mName === myNick);
      const mRole = m.role || "일반";
      const mClass = m.job_class || m.class_name || "직업 미설정";
      const mAvatar = (m.avatar && m.avatar.trim()) ? m.avatar : (mClass.split(' ')[0] || "👤");

      let roleBadge = "";
      if (mRole === "길드장" || mRole === "길마") {
        roleBadge = `<span class="badge bg-warning text-dark px-1 py-0" style="font-size:0.62rem;">길마</span>`;
      } else if (mRole === "부길드장" || mRole === "부길마") {
        roleBadge = `<span class="badge bg-primary text-white px-1 py-0" style="font-size:0.62rem;">부길마</span>`;
      } else if (mRole === "정예") {
        roleBadge = `<span class="badge bg-info text-dark px-1 py-0" style="font-size:0.62rem;">정예</span>`;
      }

      return `
        <div class="chat-room-card friend-list-item" onclick="handleFriendItemClick('${mName}', '${mAvatar}', '${mClass}', '${mRole}')">
          <div class="room-avatar-large">${mAvatar}</div>
          <div class="room-content-box">
            <div class="d-flex align-items-center gap-1">
              <span class="room-name-text">${mName}</span>
              ${roleBadge}
              ${isMe ? '<span class="badge bg-secondary bg-opacity-25 text-secondary px-1" style="font-size:0.6rem;">나</span>' : ''}
            </div>
            <p class="room-msg-preview">${mClass}</p>
          </div>
          <div class="chat-room-meta">
            ${isMe ? '' : `
              <button type="button" class="btn btn-outline-warning btn-xs px-2 py-1 fw-bold" style="font-size:0.7rem; border-radius:12px;" onclick="event.stopPropagation(); startDirectChatWith('${mName}')">
                1:1 톡
              </button>
            `}
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    container.innerHTML = `<div class="text-center py-4 text-danger small">길드원 목록 로드 실패: ${err.message}</div>`;
  }
};

window.handleFriendItemClick = function(mName, mAvatar, mClass, mRole) {
  if (typeof openMemberProfileCard === "function") {
    openMemberProfileCard(mName, mAvatar, mClass, mRole);
  } else {
    startDirectChatWith(mName);
  }
};

// --------------------------------------------------------
// 3. [채팅 탭] 참여 중인 대화방 목록 로딩 & 렌더링 (최신 메시지 미리보기 & 붉은색 안 읽은 뱃지)
// --------------------------------------------------------
window.loadMainTabRoomsList = async function() {
  const container = document.getElementById("mainTabRoomsList");
  if (!container) return;

  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");

  try {
    let serverRooms = [];
    const currentGid = localStorage.getItem("current_guild_id");
    let joined = [];
    try { joined = JSON.parse(localStorage.getItem("my_joined_guilds") || "[]"); } catch(e) {}
    const curGuild = joined.find(g => g.guild_id === currentGid);
    const guildTitle = (curGuild && curGuild.guild_name) ? `${curGuild.guild_name} 전체 대화방` : "길드 전체 대화방";

    // 1) 서버 대화방 조회 (관계 조인 실패 방어)
    if (typeof apiRequest === "function" && currentGid) {
      try {
        serverRooms = await apiRequest("chat_rooms?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*&order=created_at.asc");
      } catch(e) {
        try {
          serverRooms = await apiRequest("chat_rooms?select=*&order=created_at.asc");
        } catch(e2) {}
      }
    }

    // 2) 로컬 보존 1:1 대화방 및 생성 대화방 복원 & 레거시 ID 마이그레이션 (증발 방지 핵심)
    let localRooms = [];
    try { localRooms = JSON.parse(localStorage.getItem("local_custom_rooms") || "[]"); } catch(e) {}

    // 레거시 direct_ 방 ID를 정식 결정론적 UUID로 마이그레이션
    let didMigrate = false;
    localRooms.forEach(r => {
      if (r && r.room_type === "direct") {
        let nA = "", nB = "";
        if (Array.isArray(r.members) && r.members.length === 2) {
          nA = r.members[0]; nB = r.members[1];
        } else if (r.room_name && r.room_name.includes("&")) {
          const parts = r.room_name.split("&");
          nA = parts[0].trim();
          nB = parts[1].replace("1:1 톡방", "").replace("1:1 대화방", "").trim();
        }
        if (nA && nB) {
          const sorted = [nA, nB].sort();
          const canonicalUUID = generateDeterministicUUID("direct__" + sorted[0] + "__" + sorted[1]);
          if (r.id !== canonicalUUID) {
            r.id = canonicalUUID;
            r.members = sorted;
            didMigrate = true;
          }
        }
      }
    });
    if (didMigrate) {
      try { localStorage.setItem("local_custom_rooms", JSON.stringify(localRooms)); } catch(e) {}
    }

    // 기본 전체 대화방
    const defaultRoom = {
      id: "default_public",
      room_name: guildTitle,
      room_type: "public",
      created_at: new Date().toISOString()
    };

    // 3) 통합 및 중복 제거
    const roomMap = new Map();
    roomMap.set("default_public", defaultRoom);

    (serverRooms || []).forEach(r => {
      if (r && r.id) roomMap.set(r.id, r);
    });

    (localRooms || []).forEach(r => {
      if (r && r.id) {
        if (r.room_type === "direct") {
          const names = r.room_name || "";
          const isMember = (Array.isArray(r.members) && r.members.includes(myNick)) || names.includes(myNick);
          if (isMember) roomMap.set(r.id, r);
        } else {
          roomMap.set(r.id, r);
        }
      }
    });

    let leftRoomIds = [];
    try { leftRoomIds = JSON.parse(localStorage.getItem("left_chat_room_ids") || "[]"); } catch(e) {}

    const myRooms = Array.from(roomMap.values()).filter(r => {
      if (leftRoomIds.includes(r.id)) return false;
      return true;
    });

    window.cachedChatRoomsList = myRooms;

    const countElem = document.getElementById("mainTabRoomCount");
    if (countElem) countElem.innerText = myRooms.length;

    // ⚡ [핵심 개선]: 현재 활성 길드(currentGid)의 최신 메시지만 엄격 조회 (타 길드/데모 메시지 유입 방지)
    let recentChats = [];
    if (typeof apiRequest === "function") {
      try {
        if (currentGid) {
          recentChats = await apiRequest("guild_chats?guild_id=eq." + encodeURIComponent(currentGid) + "&select=id,room_id,sender_name,message,created_at,msg_type&order=id.desc&limit=300");
        }
      } catch(e) {}
      if (!recentChats || recentChats.length === 0) {
        try {
          recentChats = await apiRequest("guild_chats?select=id,room_id,sender_name,message,created_at,msg_type&order=id.desc&limit=300");
        } catch(e2) {
          console.warn("Failed to fetch recent chats for room previews:", e2);
        }
      }
    }

    // 방별 메시지 그룹핑 (일반 대화 chat 만 필터 & 레거시 room_id 매핑)
    const roomMsgMap = new Map();
    (recentChats || []).forEach(c => {
      if (c.msg_type && c.msg_type !== "chat") return; // 알림/브리핑 제외 순수 대화만 반영

      let rId = (!c.room_id || c.room_id === "default_public" || c.room_id === "public") ? "default_public" : c.room_id;

      // 만약 레거시 direct_ 형식의 메시지라면 canonical UUID로 매핑하여 일치시킴
      if (rId && rId.startsWith("direct_")) {
        const clean = rId.replace("direct_", "").replace("direct__", "");
        const parts = clean.split("__");
        if (parts.length === 2) {
          const sorted = [parts[0], parts[1]].sort();
          rId = generateDeterministicUUID("direct__" + sorted[0] + "__" + sorted[1]);
        }
      }

      if (!roomMsgMap.has(rId)) {
        roomMsgMap.set(rId, []);
      }
      roomMsgMap.get(rId).push(c);
    });

    container.innerHTML = myRooms.map(r => {
      let iconClass = "fa-users";
      let typeClass = "";
      let typeBadge = "";

      if (r.room_type === "private") {
        iconClass = "fa-shield-halved";
        typeClass = "private";
        typeBadge = `<span class="badge bg-danger bg-opacity-25 text-danger ms-1" style="font-size:0.6rem;">운영진</span>`;
      } else if (r.room_type === "direct") {
        iconClass = "fa-user";
        typeClass = "direct";
        typeBadge = `<span class="badge bg-info bg-opacity-25 text-info ms-1" style="font-size:0.6rem;">1:1</span>`;
      } else {
        typeBadge = `<span class="badge bg-warning bg-opacity-25 text-warning ms-1" style="font-size:0.6rem;">전체</span>`;
      }

      const safeRoomName = (r.room_name || "대화방").replace(/'/g, "\\'");

      // 해당 방의 메시지 목록 (id desc 정렬 상태)
      const msgs = roomMsgMap.get(r.id) || [];
      const lastMsg = msgs.length > 0 ? msgs[0] : null;

      // ⚡ [작성자 닉네임 + 내용 미리보기]: 단체톡은 '누구: 내용', 1:1톡은 '내용'으로 카카오톡 규격 일치
      let lastText = "대화를 시작해 보세요.";
      if (lastMsg && lastMsg.message) {
        const cleanMsg = (typeof escapeHtmlText === "function") ? escapeHtmlText(lastMsg.message) : lastMsg.message;
        if (r.room_type === "direct") {
          lastText = cleanMsg;
        } else {
          const senderLabel = (lastMsg.sender_name === myNick) ? "나" : (lastMsg.sender_name || "길드원");
          lastText = `${senderLabel}: ${cleanMsg}`;
        }
      }

      // 마지막 메시지 시간
      let lastTimeStr = "";
      if (lastMsg && lastMsg.created_at) {
        lastTimeStr = (typeof formatKSTChatTime === "function") ? formatKSTChatTime(lastMsg.created_at) : "";
      } else {
        lastTimeStr = (typeof formatTime24Hour === "function") ? formatTime24Hour(r.created_at || new Date()) : "";
      }

      // 안 읽은 새 메시지 수 계산
      const lastReadId = parseInt(localStorage.getItem("last_read_chat_id_" + r.id) || "0", 10);
      let unreadCount = 0;
      if (lastReadId > 0) {
        unreadCount = msgs.filter(m => (m.id > lastReadId) && (m.sender_name !== myNick)).length;
      } else {
        // 첫 진입 전: 현재 최신 메시지 id를 기준으로 기록해두어 이후 새 메시지만 카운트
        if (lastMsg && lastMsg.id) {
          localStorage.setItem("last_read_chat_id_" + r.id, String(lastMsg.id));
        }
        unreadCount = 0;
      }

      // ⚡ [빨강점 방지]: 0개일 때는 완전히 태그를 숨겨 빈 빨간 원이 노출되지 않도록 처리
      const unreadBadgeHtml = (unreadCount > 0)
        ? `<span class="kakao-room-unread-badge" id="room_badge_${r.id}" data-count="${unreadCount}">${unreadCount > 99 ? '99+' : unreadCount}</span>`
        : `<span class="kakao-room-unread-badge d-none" id="room_badge_${r.id}" data-count="0" style="display: none !important;"></span>`;

      return `
        <div class="chat-room-card" onclick="openChatRoom('${r.id}', '${safeRoomName}', '${r.room_type}')">
          <div class="room-avatar-large ${typeClass}">
            <i class="fa-solid ${iconClass}"></i>
          </div>
          <div class="room-content-box">
            <div class="d-flex align-items-center gap-1">
              <span class="room-name-text">${r.room_name}</span>
              ${typeBadge}
            </div>
            <p class="room-msg-preview" id="room_preview_${r.id}">${lastText}</p>
          </div>
          <div class="chat-room-meta">
            <span class="chat-room-time" id="room_time_${r.id}">${lastTimeStr}</span>
            <div class="chat-room-badge-row">
              ${(r.id !== "default_public") ? `
                <button type="button" class="btn-room-leave-action" title="방 나가기" onclick="event.stopPropagation(); handleLeaveChatRoom('${r.id}', '${safeRoomName}')">
                  <i class="fa-solid fa-arrow-right-from-bracket"></i>
                </button>
              ` : ''}
              ${unreadBadgeHtml}
            </div>
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("Chat rooms load error:", err);
    container.innerHTML = `<div class="text-danger small text-center py-4">대화방 목록을 불러오지 못했습니다.</div>`;
  }
};

// --------------------------------------------------------
// ⚡ 실시간 대화방 목록 미리보기 & 붉은색 안 읽은 뱃지 갱신
// --------------------------------------------------------
window.updateRoomCardRealtime = function(roomId, newMsg) {
  if (!roomId || !newMsg) return;
  let targetId = (!roomId || roomId === "default_public" || roomId === "public") ? "default_public" : roomId;

  // 만약 레거시 direct_ 형식의 메시지라면 canonical UUID로 매핑
  if (targetId && targetId.startsWith("direct_")) {
    const clean = targetId.replace("direct_", "").replace("direct__", "");
    const parts = clean.split("__");
    if (parts.length === 2) {
      const sorted = [parts[0], parts[1]].sort();
      targetId = generateDeterministicUUID("direct__" + sorted[0] + "__" + sorted[1]);
    }
  }

  const previewElem = document.getElementById("room_preview_" + targetId);
  const timeElem = document.getElementById("room_time_" + targetId);
  const badgeElem = document.getElementById("room_badge_" + targetId);

  const myNick = localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "";
  const isPublic = (targetId === "default_public");

  if (previewElem && newMsg.message) {
    if (isPublic) {
      const senderLabel = (newMsg.sender_name === myNick) ? "나" : (newMsg.sender_name || "길드원");
      previewElem.innerText = `${senderLabel}: ${newMsg.message}`;
    } else {
      previewElem.innerText = newMsg.message;
    }
  }

  if (timeElem && newMsg.created_at) {
    if (typeof formatKSTChatTime === "function") {
      timeElem.innerText = formatKSTChatTime(newMsg.created_at);
    }
  }

  const activeRoom = window.currentActiveRoomId || "default_public";
  const isInChatView = (document.getElementById("chatRoomView") && document.getElementById("chatRoomView").style.display === "flex");

  // 현재 이 방을 열어놓고 보고 있다면 바로 읽음 처리
  if (isInChatView && activeRoom === targetId) {
    if (newMsg.id) {
      localStorage.setItem("last_read_chat_id_" + targetId, String(newMsg.id));
    }
    if (badgeElem) {
      badgeElem.innerText = "";
      badgeElem.setAttribute("data-count", "0");
      badgeElem.classList.add("d-none");
      badgeElem.style.display = "none";
    }
  } else {
    // 다른 방에 있거나 메인 목록 화면에 있을 때: 내가 보낸 메시지가 아니면 카운트 증가
    if (newMsg.sender_name !== myNick && badgeElem) {
      let currentCount = parseInt(badgeElem.getAttribute("data-count") || badgeElem.innerText || "0", 10);
      if (isNaN(currentCount)) currentCount = 0;
      currentCount++;
      badgeElem.innerText = currentCount > 99 ? "99+" : currentCount;
      badgeElem.setAttribute("data-count", String(currentCount));
      badgeElem.classList.remove("d-none");
      badgeElem.style.display = "inline-flex";
    }
  }
};

// --------------------------------------------------------
// 4. 대화방 나가기
// --------------------------------------------------------
window.handleLeaveChatRoom = async function(roomId, roomTitle) {
  if (!roomId || roomId === "default_public") {
    alert("기본 전체 대화방은 나갈 수 없습니다.");
    return;
  }
  if (!confirm(`'${roomTitle}' 대화방을 나가시겠습니까?\n목록에서 숨김 처리됩니다.`)) return;

  try {
    let leftRoomIds = [];
    try { leftRoomIds = JSON.parse(localStorage.getItem("left_chat_room_ids") || "[]"); } catch(e) {}
    if (!leftRoomIds.includes(roomId)) {
      leftRoomIds.push(roomId);
      localStorage.setItem("left_chat_room_ids", JSON.stringify(leftRoomIds));
    }

    let localRooms = [];
    try { localRooms = JSON.parse(localStorage.getItem("local_custom_rooms") || "[]"); } catch(e) {}
    localRooms = localRooms.filter(r => r.id !== roomId);
    localStorage.setItem("local_custom_rooms", JSON.stringify(localRooms));

    if (window.currentActiveRoomId === roomId) {
      exitChatRoomToMain();
    }
    loadMainTabRoomsList();
    if (typeof showKakaoToast === "function") showKakaoToast("대화방에서 퇴장했습니다.", "👋");
  } catch (err) {
    alert("방 나가기 실패: " + err.message);
  }
};

// --------------------------------------------------------
// 5. 대화방 입장 및 전환
// --------------------------------------------------------
window.openChatRoom = function(roomId, roomTitle, roomType) {
  window.currentActiveRoomId = roomId;
  window.currentActiveRoomType = roomType || ((roomId && roomId.includes("-")) ? "direct" : "public");
  window.currentActiveRoomTitle = roomTitle || "길드 대화방";

  // 해당 방의 안 읽은 뱃지 즉시 숨김 및 초기화
  const badgeElem = document.getElementById('room_badge_' + roomId);
  if (badgeElem) {
    badgeElem.innerText = '';
    badgeElem.setAttribute('data-count', '0');
    badgeElem.classList.add('d-none');
    badgeElem.style.display = 'none';
  }

  const mainView = document.getElementById("kakaoMainTabsView");
  const chatView = document.getElementById("chatRoomView");

  if (mainView) mainView.style.display = "none";
  if (chatView) chatView.style.display = "flex";
  document.body.classList.remove("in-main-tabs");

  // 대화방 타이틀 및 아바타 갱신
  const titleElem = document.getElementById("chatRoomTitle");
  const avatarElem = document.getElementById("chatRoomAvatar");

  if (titleElem) titleElem.innerText = roomTitle || "길드 대화방";
  if (avatarElem) {
    if (roomType === "private") {
      avatarElem.innerHTML = `<i class="fa-solid fa-shield-halved text-danger"></i>`;
    } else if (roomType === "direct") {
      avatarElem.innerHTML = `<i class="fa-solid fa-user text-info"></i>`;
    } else {
      avatarElem.innerHTML = `<i class="fa-solid fa-users text-warning"></i>`;
    }
  }

  const countElem = document.getElementById("roomMemberCountText");
  if (countElem) {
    countElem.innerText = (window.currentActiveRoomType === "direct") ? "2" : ((window.cachedMemberList && window.cachedMemberList.length > 0) ? window.cachedMemberList.length : 0);
  }

  const btnLeave = document.getElementById("btnLeaveCurrentRoom");
  if (btnLeave) {
    btnLeave.style.display = (roomId !== "default_public") ? "inline-flex" : "none";
  }

  // 해당 방의 대화 내역 불러오기
  if (typeof loadPastChatMessages === "function") {
    loadPastChatMessages();
  }
};

window.exitChatRoomToMain = window.leaveChatRoomToMainTabs = function() {
  const mainView = document.getElementById("kakaoMainTabsView");
  const chatView = document.getElementById("chatRoomView");

  if (chatView) chatView.style.display = "none";
  if (mainView) mainView.style.display = "flex";
  document.body.classList.add("in-main-tabs");

  window.currentActiveRoomId = "default_public";
  window.currentActiveRoomType = "public";
  window.switchMainBottomTab("chats");
};

// --------------------------------------------------------
// 6. 1:1 대화방 시작 (표준 UUID 변환 및 상호 연동)
// --------------------------------------------------------
window.startDirectChatWith = async function(targetNick) {
  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");
  if (!myNick) {
    if (typeof showKakaoToast === "function") showKakaoToast("로그인이 필요합니다.", "⚠️");
    return;
  }
  if (myNick === targetNick) {
    if (typeof showKakaoToast === "function") showKakaoToast("자신과의 1:1 대화는 지원하지 않습니다.", "⚠️");
    return;
  }

  try {
    const currentGid = localStorage.getItem("current_guild_id");
    // 안정적인 1:1 방 식별자 (표준 UUID 규격) 및 통일된 제목 생성 (두 사람 가나다순 정렬 결합)
    const sortedNames = [myNick, targetNick].sort();
    const rawDirectKey = "direct__" + sortedNames[0] + "__" + sortedNames[1];
    const newRoomId = generateDeterministicUUID(rawDirectKey);
    const roomTitle = `${sortedNames[0]} & ${sortedNames[1]} 1:1 톡방`;

    // 1) 나간 방 목록에 있었다면 해제
    let leftRoomIds = [];
    try { leftRoomIds = JSON.parse(localStorage.getItem("left_chat_room_ids") || "[]"); } catch(e) {}
    if (leftRoomIds.includes(newRoomId)) {
      leftRoomIds = leftRoomIds.filter(id => id !== newRoomId);
      localStorage.setItem("left_chat_room_ids", JSON.stringify(leftRoomIds));
    }

    // 2) 로컬 1:1 대화방 목록 영구 보존 등록 (목록 증발 방지)
    let localRooms = [];
    try { localRooms = JSON.parse(localStorage.getItem("local_custom_rooms") || "[]"); } catch(e) {}
    let existing = localRooms.find(r => r.id === newRoomId);
    if (!existing) {
      existing = {
        id: newRoomId,
        room_name: roomTitle,
        room_type: "direct",
        created_by: myNick,
        members: [myNick, targetNick],
        created_at: new Date().toISOString()
      };
      localRooms.push(existing);
      localStorage.setItem("local_custom_rooms", JSON.stringify(localRooms));
    }

    // 3) 서버 DB 등록 시도 (실패해도 로컬 캐시로 안전하게 진행)
    try {
      if (typeof apiRequest === "function") {
        const roomPayload = {
          id: newRoomId,
          room_name: roomTitle,
          room_type: "direct",
          created_by: myNick
        };
        if (currentGid) roomPayload.guild_id = currentGid;
        await apiRequest("chat_rooms", "POST", [roomPayload]);
      }
    } catch(dbErr) {
      console.warn("Direct chat DB insert error (fallback to local):", dbErr);
    }

    if (typeof showKakaoToast === "function") {
      showKakaoToast(`[${targetNick}] 님과의 1:1 대화방에 입장했습니다.`, "💬");
    }
    openChatRoom(newRoomId, roomTitle, "direct");
  } catch (err) {
    console.error("startDirectChatWith error:", err);
    if (typeof showKakaoToast === "function") {
      showKakaoToast("1:1 대화 연결 실패: " + err.message, "❌");
    }
  }
};

// --------------------------------------------------------
// 7. 개인 설정 탭 & 프로필 모달 제어
// --------------------------------------------------------
window.loadMainTabSettingsPage = async function() {
  const container = document.getElementById("tabMoreContent");
  if (!container) return;

  const myNick = localStorage.getItem("guild_my_nickname") || "로그인 필요";
  const myClass = localStorage.getItem("guild_my_class") || "직업 설정하기";
  const myAvatar = localStorage.getItem("guild_my_avatar") || "👤";
  const myRole = localStorage.getItem("guild_my_role") || "일반";

  const nickElem = document.getElementById("mainTabMyNick");
  const classElem = document.getElementById("mainTabMyClass");
  const avatarElem = document.getElementById("mainTabMyAvatar");

  if (nickElem) nickElem.innerText = myNick;
  if (classElem) classElem.innerText = myClass;
  if (avatarElem) avatarElem.innerText = myAvatar;
};

window.openProfileEditModal = function() {
  const modal = document.getElementById("modalProfileEdit");
  if (modal) modal.style.display = "flex";
};

window.closeProfileEditModal = function() {
  const modal = document.getElementById("modalProfileEdit");
  if (modal) modal.style.display = "none";
};

window.openMemberProfileCard = function(nick, avatar, className, role) {
  const modal = document.getElementById("modalMemberProfileCard");
  if (!modal) return;
  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");
  const isMe = (nick === myNick);

  const avElem = document.getElementById("profCardAvatar");
  const nickElem = document.getElementById("profCardNick");
  const classElem = document.getElementById("profCardClass");
  const badgeElem = document.getElementById("profCardBadge");
  const actElem = document.getElementById("profCardActionArea");

  if (avElem) avElem.innerText = avatar || "👤";
  if (nickElem) nickElem.innerText = nick || "길드원";
  if (classElem) classElem.innerText = className || "클래스 미지정";

  if (badgeElem) {
    if (role === "길드장" || role === "길마") {
      badgeElem.innerHTML = '<span class="badge bg-warning text-dark px-1 py-0 me-1" style="font-size:0.65rem;">길마</span>';
    } else if (role === "부길드장" || role === "부길마") {
      badgeElem.innerHTML = '<span class="badge bg-primary text-white px-1 py-0 me-1" style="font-size:0.65rem;">부길마</span>';
    } else if (role === "정예") {
      badgeElem.innerHTML = '<span class="badge bg-info text-dark px-1 py-0 me-1" style="font-size:0.65rem;">정예</span>';
    } else {
      badgeElem.innerHTML = '<span class="badge bg-secondary bg-opacity-25 text-secondary px-1 py-0 me-1" style="font-size:0.65rem;">길드원</span>';
    }
  }

  if (actElem) {
    if (isMe) {
      actElem.innerHTML = '<button type="button" class="btn btn-warning btn-sm w-100 fw-bold py-2" style="background:#fee500; border:none; color:#191919; border-radius:8px; font-size:0.82rem;" onclick="closeMemberProfileCard(); openProfileEditModal();"><i class="fa-solid fa-pen me-1"></i>내 프로필 변경하기</button>';
    } else {
      actElem.innerHTML = '<button type="button" class="btn btn-warning btn-sm w-100 fw-bold py-2" style="background:#fee500; border:none; color:#191919; border-radius:8px; font-size:0.82rem;" onclick="closeMemberProfileCard(); startDirectChatWith(\'' + nick + '\');"><i class="fa-solid fa-comment me-1"></i>1:1 대화하기</button>';
    }
  }

  modal.style.display = "flex";
};

window.closeMemberProfileCard = function() {
  const modal = document.getElementById("modalMemberProfileCard");
  if (modal) modal.style.display = "none";
};

window.selectClassProfile = async function(icon, className) {
  const myClass = `${icon} ${className}`;
  localStorage.setItem("guild_my_avatar", icon);
  localStorage.setItem("guild_my_class", myClass);

  if (typeof updateProfileUI === "function") {
    updateProfileUI();
  }

  const myNick = localStorage.getItem("guild_my_nickname") || "";
  if (myNick && typeof apiRequest === "function") {
    try {
      await apiRequest(`guild_members?name=eq.${encodeURIComponent(myNick)}`, "PATCH", {
        job_class: myClass,
        avatar: icon
      });
    } catch(e) {}
  }

  closeProfileEditModal();
  if (typeof showKakaoToast === "function") {
    showKakaoToast(`직업이 [${className}] (으)로 변경되었습니다.`, icon);
  }
};

// --------------------------------------------------------
// 8. 새 대화방 개설 모달 제어
// --------------------------------------------------------
window.openCreateRoomModal = function() {
  const modal = document.getElementById("modalCreateRoom");
  if (!modal) return;

  const select = document.getElementById("oneOnOneTargetSelect");
  if (select && window.cachedMemberList) {
    const myNick = localStorage.getItem("guild_my_nickname") || "";
    const targets = window.cachedMemberList.filter(m => (m.name || m.nickname) !== myNick);
    select.innerHTML = targets.map(m => {
      const n = m.name || m.nickname;
      return `<option value="${n}">${n}</option>`;
    }).join("");
  }

  modal.style.display = "flex";
};

window.closeCreateRoomModal = function() {
  const modal = document.getElementById("modalCreateRoom");
  if (modal) modal.style.display = "none";
};

window.onRoomTypeChange = function(type) {
  const titleGroup = document.getElementById("roomTitleInputGroup");
  const targetGroup = document.getElementById("oneOnOneTargetGroup");

  if (type === "one_on_one") {
    if (titleGroup) titleGroup.style.display = "none";
    if (targetGroup) targetGroup.style.display = "block";
  } else {
    if (titleGroup) titleGroup.style.display = "block";
    if (targetGroup) targetGroup.style.display = "none";
  }
};

window.executeCreateNewRoom = async function() {
  const myNick = localStorage.getItem("guild_my_nickname") || "";
  const currentGid = localStorage.getItem("current_guild_id");
  const typeSelect = document.getElementById("newRoomTypeSelect");
  const type = typeSelect ? typeSelect.value : "group";

  if (type === "one_on_one") {
    const targetSelect = document.getElementById("oneOnOneTargetSelect");
    const target = targetSelect ? targetSelect.value : "";
    if (!target) return alert("대화 상대를 선택하세요.");
    closeCreateRoomModal();
    startDirectChatWith(target);
    return;
  }

  const titleInput = document.getElementById("newRoomTitleInput");
  const title = (titleInput ? titleInput.value : "").trim();
  if (!title) return alert("대화방 이름을 입력하세요.");

  try {
    const roomPayload = {
      room_name: title,
      room_type: (type === "secret") ? "private" : "public",
      created_by: myNick
    };
    if (currentGid) roomPayload.guild_id = currentGid;

    let newRoom = { id: generateDeterministicUUID("custom_" + Date.now()), room_name: title, room_type: roomPayload.room_type, created_by: myNick, created_at: new Date().toISOString() };
    if (typeof apiRequest === "function") {
      try {
        const res = await apiRequest("chat_rooms", "POST", [roomPayload]);
        if (res && res[0]) newRoom = res[0];
      } catch(e) {}
    }

    // 로컬 보존 등록
    let localRooms = [];
    try { localRooms = JSON.parse(localStorage.getItem("local_custom_rooms") || "[]"); } catch(e) {}
    localRooms.push(newRoom);
    localStorage.setItem("local_custom_rooms", JSON.stringify(localRooms));

    closeCreateRoomModal();
    loadMainTabRoomsList();
    openChatRoom(newRoom.id, title, newRoom.room_type);
  } catch (err) {
    alert("방 개설 실패: " + err.message);
  }
};

// --------------------------------------------------------
// 9. 실시간 대화방 생성 동기화 & 초기화
// --------------------------------------------------------
window.initRoomsRealtime = function() {
  if (!window.supabaseClient) return;

  try {
    window.supabaseClient
      .channel("public:chat_rooms")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_rooms" }, () => {
        loadMainTabRoomsList();
      })
      .subscribe();
  } catch(e) {}
};

window.addEventListener("DOMContentLoaded", () => {
  initRoomsRealtime();
  if (typeof window.loadMainTabRoomsList === "function") {
    window.loadMainTabRoomsList();
  }
});

// 브라우저 새로고침 시 대화방 목록 즉각 렌더링 (스피너 멈춤 완전 방지)
if (document.readyState === "complete" || document.readyState === "interactive") {
  setTimeout(() => {
    if (typeof window.loadMainTabRoomsList === "function") {
      window.loadMainTabRoomsList();
    }
  }, 50);
}
