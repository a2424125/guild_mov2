// ========================================================
// [길드톡 메신저] 카카오톡 스타일 메인 3탭 & 다중 톡방 관리 모듈 (rooms.js)
// 친구 목록 / 대화방 목록 / 개인설정 탭 제어 및 방 개설(운영진방, 1:1 개인톡)
// ========================================================

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
window.currentActiveRoomType = null;
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

  if (navFriends) navFriends.classList.remove("active");
  if (navChats) navChats.classList.remove("active");
  if (navMore) navMore.classList.remove("active");

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
    if (navChats) navChats.classList.add("active");
    if (tabChats) tabChats.style.display = "block";
    if (headerTitle) headerTitle.innerText = "대화방";
    if (headerSubtitle) headerSubtitle.innerText = "";
    if (btnCreateRoom) btnCreateRoom.style.display = "inline-flex";
    loadMainTabRoomsList();
  }
};

// --------------------------------------------------------
// 2. [친구 탭] 길드원 리스트 렌더링 & 클릭 제어
// --------------------------------------------------------
window.loadMainTabFriendsList = async function() {
  const container = document.getElementById("mainTabFriendsList");
  if (!container) return;

  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");
  const myAvatar = localStorage.getItem("guild_my_avatar") || "👤";
  const myClass = localStorage.getItem("guild_my_class") || "직업 설정하기";

  const myNickElem = document.getElementById("mainTabMyNick");
  const myAvatarElem = document.getElementById("mainTabMyAvatar");
  const myClassElem = document.getElementById("mainTabMyClass");

  if (myNickElem) myNickElem.innerText = myNick || "로그인 필요";
  if (myAvatarElem) myAvatarElem.innerText = myAvatar;
  if (myClassElem) myClassElem.innerText = myClass;

  try {
    let members = window.cachedMemberList || [];
    if (!members || members.length === 0) {
      if (typeof window.loadGuildMembersData === "function") {
        await window.loadGuildMembersData();
        members = window.cachedMemberList || [];
      }
    }

    const countElem = document.getElementById("mainTabMemberCount");
    if (countElem) countElem.innerText = members.length;

    if (!members || members.length === 0) {
      container.innerHTML = `<div class="text-secondary small text-center py-4">등록된 길드원이 없습니다.</div>`;
      return;
    }

    container.innerHTML = members.map(m => {
      const mName = m.name || m.nickname || "길드원";
      const mAvatar = m.avatar || (m.job_class ? m.job_class.split(" ")[0] : "👤");
      const mClass = m.job_class || m.class_name || "직업 미지정";
      const mRole = m.role || "일반";
      const isMe = (mName === myNick);

      let roleBadge = "";
      if (mRole === "길드장" || mRole === "길마") {
        roleBadge = `<span class="badge bg-warning text-dark px-1 py-0 me-1" style="font-size:0.62rem;">길마</span>`;
      } else if (mRole === "부길드장" || mRole === "부길마") {
        roleBadge = `<span class="badge bg-primary text-white px-1 py-0 me-1" style="font-size:0.62rem;">부길마</span>`;
      } else if (mRole === "정예") {
        roleBadge = `<span class="badge bg-info text-dark px-1 py-0 me-1" style="font-size:0.62rem;">정예</span>`;
      }

      const safeName = mName.replace(/'/g, "\\'");
      const safeAvatar = mAvatar.replace(/'/g, "\\'");
      const safeClass = mClass.replace(/'/g, "\\'");
      const safeRole = mRole.replace(/'/g, "\\'");

      return `
        <div class="friend-item-card" onclick="handleFriendItemClick('${safeName}', '${safeAvatar}', '${safeClass}', '${safeRole}')">
          <div class="friend-avatar">${mAvatar}</div>
          <div class="room-content-box">
            <div class="d-flex align-items-center" style="gap: 4px;">
              ${roleBadge}
              <span class="room-name-text">${mName}</span>
              ${isMe ? '<span class="badge bg-secondary bg-opacity-25 text-secondary ms-1" style="font-size:0.6rem;">나</span>' : ''}
            </div>
            <p class="room-msg-preview">${mClass}</p>
          </div>
          ${isMe ? 
            '<i class="fa-solid fa-pen text-secondary me-1" style="font-size:0.8rem;" title="프로필 변경"></i>' : 
            `<button type="button" class="btn btn-outline-warning btn-xs py-1 px-2" style="font-size:0.68rem; border-radius:5px;" onclick="event.stopPropagation(); startDirectChatWith('${safeName}');"><i class="fa-solid fa-comment-dots me-1"></i>1:1 대화</button>`
          }
        </div>
      `;
    }).join("");
  } catch (err) {
    container.innerHTML = `<div class="text-danger small text-center py-4">길드원 목록을 불러오지 못했습니다.</div>`;
  }
};

window.handleFriendItemClick = function(mName, mAvatar, mClass, mRole) {
  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");
  if (mName === myNick) {
    window.openProfileEditModal();
  } else {
    window.openMemberProfileCard(mName, mAvatar, mClass, mRole);
  }
};

// --------------------------------------------------------
// 3. [채팅 탭] 참여 중인 대화방 목록 로딩 & 렌더링
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

    if (typeof apiRequest === "function" && currentGid) {
      try {
        serverRooms = await apiRequest("chat_rooms?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*&order=created_at.asc");
      } catch(e) {
        try {
          serverRooms = await apiRequest("chat_rooms?select=*&order=created_at.asc");
        } catch(e2) {}
      }
    }

    let localRooms = [];
    try { localRooms = JSON.parse(localStorage.getItem("local_custom_rooms") || "[]"); } catch(e) {}

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
      localStorage.setItem("local_custom_rooms", JSON.stringify(localRooms));
    }

    const defaultRoom = {
      id: "default_public",
      room_name: guildTitle,
      room_type: "public",
      is_default: true,
      created_at: new Date(0).toISOString()
    };

    const roomMap = new Map();
    roomMap.set(defaultRoom.id, defaultRoom);

    (serverRooms || []).forEach(r => {
      if (r.room_type === "direct") {
        let isParticipant = false;
        if (Array.isArray(r.members)) {
          isParticipant = r.members.includes(myNick);
        } else if (r.room_name && r.room_name.includes(myNick)) {
          isParticipant = true;
        } else if (r.created_by === myNick) {
          isParticipant = true;
        }
        if (isParticipant) roomMap.set(r.id, r);
      } else {
        roomMap.set(r.id, r);
      }
    });

    (localRooms || []).forEach(r => {
      if (!roomMap.has(r.id)) {
        if (r.room_type === "direct") {
          const isMember = (Array.isArray(r.members) && r.members.includes(myNick)) ||
                           (r.room_name && r.room_name.includes(myNick)) ||
                           (r.created_by === myNick);
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
        } catch(e2) {}
      }
    }

    const roomMsgMap = new Map();
    (recentChats || []).forEach(c => {
      if (c.msg_type && c.msg_type !== "chat") return;

      let rId = (!c.room_id || c.room_id === "default_public" || c.room_id === "public") ? "default_public" : c.room_id;

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

      const msgs = roomMsgMap.get(r.id) || [];
      const lastMsg = msgs.length > 0 ? msgs[0] : null;

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

      let lastTimeStr = "";
      if (lastMsg && lastMsg.created_at) {
        lastTimeStr = (typeof formatKSTChatTime === "function") ? formatKSTChatTime(lastMsg.created_at) : "";
      } else {
        lastTimeStr = (typeof formatTime24Hour === "function") ? formatTime24Hour(r.created_at || new Date()) : "";
      }

      // 안 읽은 새 메시지 수 계산 (방별 완벽 독립 격리)
      const lastReadId = parseInt(localStorage.getItem("last_read_chat_id_" + r.id) || "0", 10);
      let unreadCount = 0;
      if (lastReadId > 0) {
        unreadCount = msgs.filter(m => (m.id > lastReadId) && (m.sender_name !== myNick)).length;
      } else {
        // 첫 진입 전: 사용자가 직접 방에 들어가서 확인하기 전까지는 상대방이 보낸 모든 메시지를 안 읽은 것으로 정상 집계!
        // (절대로 임의로 last_read_chat_id를 덮어써서 0으로 지워버리지 않음)
        unreadCount = msgs.filter(m => m.sender_name !== myNick).length;
      }

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
              ${unreadBadgeHtml}
            </div>
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    container.innerHTML = `<div class="text-danger small text-center py-4">대화방 목록을 불러오지 못했습니다.</div>`;
  }
};

// --------------------------------------------------------
// 4. 실시간 대화 수신 시 목록의 미리보기 및 안 읽은 뱃지 갱신
// --------------------------------------------------------
window.updateRoomCardRealtime = function(roomId, newMsg) {
  let targetId = roomId;
  if (!targetId || targetId === "public" || targetId === "default_public") {
    targetId = "default_public";
  }

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

  const isInChatView = (document.getElementById("chatRoomView") && document.getElementById("chatRoomView").style.display === "flex");
  const isViewingThisRoom = isInChatView && (window.currentActiveRoomId === targetId);

  // 현재 사용자가 실제로 이 방을 열어놓고 보고 있을 때만 즉시 읽음 처리
  if (isViewingThisRoom) {
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
      let currentCount = parseInt(badgeElem.getAttribute("data-count") || "0", 10);
      if (isNaN(currentCount)) currentCount = 0;
      currentCount++;
      badgeElem.innerText = currentCount > 99 ? "99+" : currentCount;
      badgeElem.setAttribute("data-count", String(currentCount));
      badgeElem.classList.remove("d-none");
      badgeElem.style.display = "inline-flex";
    }
  }
};

window.handleLeaveChatRoom = async function(roomId, roomTitle) {
  if (!roomId || roomId === "default_public") {
    alert("기본 전체 대화방은 나갈 수 없습니다.");
    return;
  }

  if (!confirm(`[${roomTitle}] 대화방에서 나가시겠습니까?\n목록에서 완전히 삭제됩니다.`)) {
    return;
  }

  try {
    let localRooms = [];
    try { localRooms = JSON.parse(localStorage.getItem("local_custom_rooms") || "[]"); } catch(e) {}
    localRooms = localRooms.filter(r => r.id !== roomId);
    localStorage.setItem("local_custom_rooms", JSON.stringify(localRooms));

    let leftRoomIds = [];
    try { leftRoomIds = JSON.parse(localStorage.getItem("left_chat_room_ids") || "[]"); } catch(e) {}
    if (!leftRoomIds.includes(roomId)) {
      leftRoomIds.push(roomId);
      localStorage.setItem("left_chat_room_ids", JSON.stringify(leftRoomIds));
    }

    if (window.currentActiveRoomId === roomId) {
      exitChatRoomToMain();
    }

    await loadMainTabRoomsList();

    if (typeof showKakaoToast === "function") {
      showKakaoToast(`[${roomTitle}] 에서 나왔습니다.`, "👋");
    }
  } catch(err) {
    alert("방 나가기 실패: " + err.message);
  }
};

window.openChatRoom = function(roomId, roomTitle, roomType) {
  window.currentActiveRoomId = roomId;
  window.currentActiveRoomType = roomType || ((roomId && roomId.includes('-')) ? 'direct' : 'public');
  window.currentActiveRoomTitle = roomTitle || '길드 대화방';

  // 해당 방의 안 읽은 뱃지 즉시 숨김 및 초기화 (오직 이 방만!)
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

  // ⚡ [핵심 방 격리]: 메인 목록 화면으로 나올 때 활성 방 ID를 반드시 null로 초기화!
  // 절대로 'default_public'으로 오지정하지 않아야 전체방 메시지가 멋대로 읽음 처리되지 않습니다.
  window.currentActiveRoomId = null;
  window.currentActiveRoomType = null;
  window.currentActiveRoomTitle = "";

  if (typeof window.switchMainBottomTab === 'function') {
    window.switchMainBottomTab("chats");
  }
};

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
    const sorted = [myNick, targetNick].sort();
    const rawKey = `direct__${sorted[0]}__${sorted[1]}`;
    const newRoomId = generateDeterministicUUID(rawKey);
    const roomTitle = `${myNick} & ${targetNick} 1:1 톡방`;

    let localRooms = [];
    try { localRooms = JSON.parse(localStorage.getItem("local_custom_rooms") || "[]"); } catch(e) {}

    let leftRoomIds = [];
    try { leftRoomIds = JSON.parse(localStorage.getItem("left_chat_room_ids") || "[]"); } catch(e) {}
    leftRoomIds = leftRoomIds.filter(id => id !== newRoomId && id !== rawKey);
    localStorage.setItem("left_chat_room_ids", JSON.stringify(leftRoomIds));

    let existingRoom = localRooms.find(r => r.id === newRoomId || r.id === rawKey);
    if (!existingRoom) {
      existingRoom = {
        id: newRoomId,
        room_name: roomTitle,
        room_type: "direct",
        members: sorted,
        created_by: myNick,
        created_at: new Date().toISOString()
      };
      localRooms.push(existingRoom);
      localStorage.setItem("local_custom_rooms", JSON.stringify(localRooms));
    } else {
      existingRoom.id = newRoomId;
      existingRoom.members = sorted;
      localStorage.setItem("local_custom_rooms", JSON.stringify(localRooms));
    }

    try {
      const currentGid = localStorage.getItem("current_guild_id");
      if (typeof apiRequest === "function") {
        const roomPayload = {
          room_name: roomTitle,
          room_type: "direct",
          created_by: myNick
        };
        if (currentGid) roomPayload.guild_id = currentGid;
        await apiRequest("chat_rooms", "POST", [roomPayload]);
        await apiRequest("room_members", "POST", [
          { room_id: newRoomId, member_nickname: myNick, role: "member" },
          { room_id: newRoomId, member_nickname: targetNick, role: "member" }
        ]);
      }
    } catch(dbErr) {}

    if (typeof showKakaoToast === "function") {
      showKakaoToast(`[${targetNick}] 님과의 1:1 대화방에 입장했습니다.`, "💬");
    }
    openChatRoom(newRoomId, roomTitle, "direct");
  } catch (err) {
    if (typeof showKakaoToast === "function") showKakaoToast("1:1 대화방 연결 실패: " + err.message, "⚠️");
  }
};

window.loadMainTabSettingsPage = async function() {
  const tabMore = document.getElementById("tabMoreContent");
  if (!tabMore) return;
  tabMore.innerHTML = `<div class="text-secondary small text-center py-4"><i class="fa-solid fa-spinner fa-spin me-2"></i>설정을 불러오는 중...</div>`;

  try {
    const res = await fetch(`pages/PageProfileSettings.html?_t=${Date.now()}`);
    if (!res.ok) throw new Error("로드 실패");
    const html = await res.text();
    tabMore.innerHTML = html;

    document.querySelectorAll(".settings-tab-script").forEach(s => s.remove());
    tabMore.querySelectorAll("script").forEach(s => {
      const sc = document.createElement("script");
      sc.className = "settings-tab-script";
      if (s.src) sc.src = s.src; else sc.textContent = s.textContent;
      document.body.appendChild(sc);
    });
  } catch (e) {
    tabMore.innerHTML = `<div class="text-danger small text-center py-4">설정 로드 실패: ${e.message}</div>`;
  }
};

window.openCreateRoomModal = function() {
  const modal = document.getElementById("modalCreateRoom");
  if (!modal) return;

  const titleInput = document.getElementById("newRoomTitleInput");
  if (titleInput) titleInput.value = "";

  const typeSelect = document.getElementById("newRoomTypeSelect");
  if (typeSelect) typeSelect.value = "group";

  populateOneOnOneTargetDropdown();
  onRoomTypeChange("group");

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

function populateOneOnOneTargetDropdown() {
  const select = document.getElementById("oneOnOneTargetSelect");
  if (!select) return;

  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");
  const members = (window.cachedMemberList || []).filter(m => {
    const name = m.name || m.nickname || "";
    return name && name !== myNick;
  });

  if (members.length === 0) {
    select.innerHTML = `<option value="">대화 가능한 길드원이 없습니다</option>`;
    return;
  }

  select.innerHTML = `<option value="">1:1 대화 상대 선택...</option>` +
    members.map(m => {
      const name = m.name || m.nickname;
      const cls = m.job_class || m.class_name || "";
      return `<option value="${name}">${name} (${cls || '길드원'})</option>`;
    }).join("");
}

window.executeCreateNewRoom = async function() {
  const typeSelect = document.getElementById("newRoomTypeSelect");
  const type = typeSelect ? typeSelect.value : "group";
  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");

  if (!myNick) {
    alert("로그인이 필요합니다.");
    return;
  }

  if (type === "one_on_one") {
    const targetSelect = document.getElementById("oneOnOneTargetSelect");
    const targetNick = targetSelect ? targetSelect.value : "";
    if (!targetNick) {
      alert("대화 상대를 선택해 주세요.");
      return;
    }
    closeCreateRoomModal();
    startDirectChatWith(targetNick);
    return;
  }

  const titleInput = document.getElementById("newRoomTitleInput");
  const title = titleInput ? titleInput.value.trim() : "";
  if (!title) {
    alert("대화방 이름을 입력해 주세요.");
    return;
  }

  try {
    const currentGid = localStorage.getItem("current_guild_id");
    const roomPayload = {
      room_name: title,
      room_type: (type === "secret" ? "private" : "group"),
      created_by: myNick
    };
    if (currentGid) roomPayload.guild_id = currentGid;

    let newRoom = { id: "room_" + Date.now(), room_name: title, room_type: roomPayload.room_type, created_by: myNick, created_at: new Date().toISOString() };
    if (typeof apiRequest === "function") {
      try {
        const res = await apiRequest("chat_rooms", "POST", [roomPayload]);
        if (res && res[0]) newRoom = res[0];
      } catch(e) {}
    }

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

window.initRoomsRealtime = function() {
  if (!window.supabaseClient) return;
  try {
    window.supabaseClient
      .channel("public:chat_rooms")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_rooms" }, () => {
        loadMainTabRoomsList();
      })
      .subscribe();
  } catch (e) {}
};

window.addEventListener("DOMContentLoaded", function() {
  const isMainTabs = document.body.classList.contains("in-main-tabs");
  if (isMainTabs && typeof window.switchMainBottomTab === "function") {
    window.switchMainBottomTab("chats");
  }
  if (typeof window.initRoomsRealtime === "function") {
    window.initRoomsRealtime();
  }
});
