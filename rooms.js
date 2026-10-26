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
window.roomMsgMapCache = new Map();

// --------------------------------------------------------
// 0. 방별 읽음 처리 & 안 읽은 메시지 수 계산 공통 함수 (길드별·방별 격리)
// --------------------------------------------------------
function getRoomReadKeyPrefix(roomId) {
  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
  const targetId = (!roomId || roomId === "public" || roomId === "default_public") ? "default_public" : roomId;
  return `${currentGid}_${targetId}`;
}

window.markRoomAsReadNow = function(roomId, customMsgs) {
  if (!roomId) return;
  const targetId = (roomId === "public" || roomId === "default_public") ? "default_public" : roomId;
  const keySuffix = getRoomReadKeyPrefix(targetId);
  const msgs = customMsgs || (window.roomMsgMapCache && window.roomMsgMapCache.get(targetId)) || [];

  let maxNumId = parseInt(localStorage.getItem("last_read_chat_id_" + keySuffix) || localStorage.getItem("last_read_chat_id_" + targetId) || "0", 10);
  if (isNaN(maxNumId)) maxNumId = 0;

  let maxTime = parseInt(localStorage.getItem("last_read_chat_time_" + keySuffix) || localStorage.getItem("last_read_chat_time_" + targetId) || "0", 10);
  if (isNaN(maxTime)) maxTime = 0;

  let latestIdStr = localStorage.getItem("last_read_chat_id_str_" + keySuffix) || localStorage.getItem("last_read_chat_id_str_" + targetId) || "";

  if (Array.isArray(msgs) && msgs.length > 0) {
    msgs.forEach(m => {
      const nId = Number(m.id);
      if (!isNaN(nId) && nId > maxNumId) {
        maxNumId = nId;
      }
      const t = new Date(m.created_at || 0).getTime();
      if (!isNaN(t) && t > maxTime) {
        maxTime = t;
      }
    });

    const firstMsg = msgs[0];
    const lastMsg = msgs[msgs.length - 1];
    const firstTime = new Date(firstMsg?.created_at || 0).getTime() || 0;
    const lastTime = new Date(lastMsg?.created_at || 0).getTime() || 0;
    const newestMsg = (lastTime > firstTime) ? lastMsg : firstMsg;
    if (newestMsg && newestMsg.id !== undefined && newestMsg.id !== null) {
      latestIdStr = String(newestMsg.id);
    }
  }

  const nowTs = Date.now();
  if (nowTs > maxTime) maxTime = nowTs;

  if (maxNumId > 0) {
    localStorage.setItem("last_read_chat_id_" + keySuffix, String(maxNumId));
    localStorage.setItem("last_read_chat_id_" + targetId, String(maxNumId));
  }
  if (latestIdStr) {
    localStorage.setItem("last_read_chat_id_str_" + keySuffix, latestIdStr);
    localStorage.setItem("last_read_chat_id_str_" + targetId, latestIdStr);
  }
  localStorage.setItem("last_read_chat_time_" + keySuffix, String(maxTime));
  localStorage.setItem("last_read_chat_time_" + targetId, String(maxTime));
  localStorage.setItem("room_has_been_read_" + keySuffix, "true");
  localStorage.setItem("room_has_been_read_" + targetId, "true");

  const badgeElem = document.getElementById("room_badge_" + targetId);
  if (badgeElem) {
    badgeElem.innerText = "";
    badgeElem.setAttribute("data-count", "0");
    badgeElem.classList.add("d-none");
    badgeElem.style.display = "none";
  }
};

window.calculateRoomUnreadCount = function(msgs, roomId, myNick) {
  if (!Array.isArray(msgs) || msgs.length === 0) return 0;
  const targetId = (!roomId || roomId === "public" || roomId === "default_public") ? "default_public" : roomId;
  const keySuffix = getRoomReadKeyPrefix(targetId);

  const hasBeenRead = (localStorage.getItem("room_has_been_read_" + keySuffix) === "true") ||
                      (localStorage.getItem("room_has_been_read_" + targetId) === "true");
  const lastReadNumId = parseInt(localStorage.getItem("last_read_chat_id_" + keySuffix) || localStorage.getItem("last_read_chat_id_" + targetId) || "0", 10) || 0;
  const lastReadIdStr = localStorage.getItem("last_read_chat_id_str_" + keySuffix) || localStorage.getItem("last_read_chat_id_str_" + targetId) || "";
  const lastReadTime = parseInt(localStorage.getItem("last_read_chat_time_" + keySuffix) || localStorage.getItem("last_read_chat_time_" + targetId) || "0", 10) || 0;

  if (!hasBeenRead && lastReadNumId === 0 && !lastReadIdStr && lastReadTime === 0) {
    return msgs.filter(m => m.sender_name !== myNick).length;
  }

  let count = 0;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (lastReadIdStr && String(m.id) === lastReadIdStr) {
      break;
    }
    const nId = Number(m.id);
    if (!isNaN(nId) && lastReadNumId > 0 && nId <= lastReadNumId) {
      continue;
    }
    const mTime = new Date(m.created_at || 0).getTime();
    if (!isNaN(mTime) && mTime > 0 && lastReadTime > 0 && mTime <= lastReadTime) {
      continue;
    }
    if (m.sender_name !== myNick) {
      count++;
    }
  }
  return count;
};

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
// 2. [친구 탭] 길드원 리스트 렌더링 & 클릭 제어 (타 길드 전체 조회 폴백 완전 제거)
// --------------------------------------------------------
window.loadMainTabFriendsList = async function() {
  const container = document.getElementById("mainTabFriendsList");
  if (!container) return;

  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");
  const myAvatar = localStorage.getItem("guild_my_avatar") || "👤";
  const myClass = localStorage.getItem("guild_my_class") || "직업 설정하기";
  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");

  const myNickElem = document.getElementById("mainTabMyNick");
  const myAvatarElem = document.getElementById("mainTabMyAvatar");
  const myClassElem = document.getElementById("mainTabMyClass");

  if (myNickElem) myNickElem.innerText = myNick || "로그인 필요";
  if (myAvatarElem) myAvatarElem.innerText = myAvatar;
  if (myClassElem) myClassElem.innerText = myClass;

  try {
    let members = [];
    if (typeof apiRequest === "function") {
      try {
        members = await apiRequest("guild_members?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*");
      } catch(e) {
        members = [];
      }
    }

    members = Array.isArray(members) ? members : [];
    members.sort((a, b) => {
      const pA = (typeof getRolePriority === "function") ? getRolePriority(a.role) : 4;
      const pB = (typeof getRolePriority === "function") ? getRolePriority(b.role) : 4;
      if (pA !== pB) return pA - pB;
      const nA = a.nickname || a.name || "";
      const nB = b.nickname || b.name || "";
      return nA.localeCompare(nB, 'ko');
    });

    window.cachedMemberList = members;

    const countElem = document.getElementById("mainTabMemberCount");
    if (countElem) countElem.innerText = members.length;

    if (members.length === 0) {
      container.innerHTML = `<div class="text-secondary small text-center py-4">등록된 길드원이 없습니다.</div>`;
      return;
    }

    container.innerHTML = members.map(m => {
      const mName = m.nickname || m.name || "길드원";
      const isMe = (mName === myNick);
      const mAvatar = m.avatar_icon || m.avatar || (m.job_class ? m.job_class.split(" ")[0] : "👤");
      const mClass = m.class_name || m.job_class || "클래스 미지정";
      const mRole = m.role || "일반";

      let roleBadge = "";
      if (mRole === "길드장" || mRole === "길마") {
        roleBadge = `<span class="badge bg-warning text-dark px-1 py-0 me-1" style="font-size:0.62rem;">길마</span>`;
      } else if (mRole === "부길드장" || mRole === "부길마" || mRole === "수호") {
        roleBadge = `<span class="badge bg-primary text-white px-1 py-0 me-1" style="font-size:0.62rem;">${mRole === "수호" ? "수호" : "부길마"}</span>`;
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
    console.error("Friends list load error:", err);
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
// 3. [채팅 탭] 참여 중인 대화방 목록 로딩 & 렌더링 (타 길드 방/채팅 전체 조회 폴백 제거)
// --------------------------------------------------------
window.loadMainTabRoomsList = async function() {
  const container = document.getElementById("mainTabRoomsList");
  if (!container) return;

  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");
  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");

  try {
    let serverRooms = [];
    let joined = [];
    try { joined = JSON.parse(localStorage.getItem("my_joined_guilds") || "[]"); } catch(e) {}
    const curGuild = joined.find(g => g.guild_id === currentGid);
    const guildTitle = (curGuild && curGuild.guild_name) ? `${curGuild.guild_name} 전체 대화방` : "길드 전체 대화방";

    if (typeof apiRequest === "function") {
      try {
        serverRooms = await apiRequest("chat_rooms?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*&order=created_at.asc");
      } catch(e) {
        serverRooms = [];
      }
    }

    let allLocalRooms = [];
    try { allLocalRooms = JSON.parse(localStorage.getItem("local_custom_rooms") || "[]"); } catch(e) {}

    let didMigrate = false;
    allLocalRooms.forEach(r => {
      if (r && r.room_type === "direct") {
        const rGid = r.guild_id || currentGid;
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
          const canonicalUUID = generateDeterministicUUID(`direct__${rGid}__${sorted[0]}__${sorted[1]}`);
          if (r.id !== canonicalUUID || !r.guild_id) {
            r.id = canonicalUUID;
            r.guild_id = rGid;
            r.members = sorted;
            didMigrate = true;
          }
        }
      }
    });
    if (didMigrate) {
      try { localStorage.setItem("local_custom_rooms", JSON.stringify(allLocalRooms)); } catch(e) {}
    }

    // 현재 길드(currentGid)에 속한 로컬 방만 필터링
    const localRooms = allLocalRooms.filter(r => !r.guild_id || r.guild_id === currentGid);

    const defaultRoom = {
      id: "default_public",
      guild_id: currentGid,
      room_name: guildTitle,
      room_type: "public",
      created_at: new Date().toISOString()
    };

    const roomMap = new Map();
    roomMap.set("default_public", defaultRoom);

    (serverRooms || []).forEach(r => {
      if (r && r.id && (!r.guild_id || r.guild_id === currentGid)) {
        if (r.room_type === "direct") {
          const names = r.room_name || "";
          const isMember = (Array.isArray(r.members) && r.members.includes(myNick)) || names.includes(myNick) || r.created_by === myNick;
          if (isMember) roomMap.set(r.id, r);
        } else {
          roomMap.set(r.id, r);
        }
      }
    });

    (localRooms || []).forEach(r => {
      if (r && r.id && !roomMap.has(r.id)) {
        if (r.room_type === "direct") {
          const names = r.room_name || "";
          const isMember = (Array.isArray(r.members) && r.members.includes(myNick)) || names.includes(myNick) || r.created_by === myNick;
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

    // 반드시 현재 guild_id의 최근 채팅만 조회 (타 길드 전체 조회 폴백 제거)
    let recentChats = [];
    if (typeof apiRequest === "function") {
      try {
        recentChats = await apiRequest(
          "guild_chats?guild_id=eq." + encodeURIComponent(currentGid) +
          "&select=id,guild_id,room_id,sender_name,message,created_at,msg_type,read_members&order=id.desc&limit=300"
        );
      } catch(e) {
        recentChats = [];
      }
    }

    const roomMsgMap = new Map();
    (recentChats || []).forEach(c => {
      if (c.guild_id && c.guild_id !== currentGid) return;
      if (c.msg_type && c.msg_type !== "chat") return;

      let rId = (!c.room_id || c.room_id === "default_public" || c.room_id === "public") ? "default_public" : c.room_id;

      if (rId && rId.startsWith("direct_")) {
        const clean = rId.replace("direct_", "").replace("direct__", "");
        const parts = clean.split("__");
        if (parts.length === 2) {
          const sorted = [parts[0], parts[1]].sort();
          rId = generateDeterministicUUID(`direct__${currentGid}__${sorted[0]}__${sorted[1]}`);
        }
      }

      if (!roomMsgMap.has(rId)) {
        roomMsgMap.set(rId, []);
      }
      roomMsgMap.get(rId).push(c);
    });

    window.roomMsgMapCache = roomMsgMap;

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

      if (msgs.length > 0) {
        try {
          const cacheKey = `chat_history_cache_${currentGid}_${r.id}`;
          const ascMsgs = [...msgs].reverse();
          sessionStorage.setItem(cacheKey, JSON.stringify(ascMsgs.slice(-100)));
          localStorage.setItem(cacheKey, JSON.stringify(ascMsgs.slice(-100)));
        } catch(e) {}
      }

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

      const unreadCount = window.calculateRoomUnreadCount(msgs, r.id, myNick);

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
    console.error("Chat rooms load error:", err);
    container.innerHTML = `<div class="text-danger small text-center py-4">대화방 목록을 불러오지 못했습니다.</div>`;
  }
};

// --------------------------------------------------------
// 4. 실시간 대화방 목록 미리보기 & 붉은색 안 읽은 뱃지 갱신
// --------------------------------------------------------
window.updateRoomCardRealtime = function(roomId, newMsg) {
  if (!newMsg) return;
  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
  if (newMsg.guild_id && newMsg.guild_id !== currentGid) return;

  let targetId = (!roomId || roomId === "default_public" || roomId === "public") ? "default_public" : roomId;

  if (targetId && targetId.startsWith("direct_")) {
    const clean = targetId.replace("direct_", "").replace("direct__", "");
    const parts = clean.split("__");
    if (parts.length === 2) {
      const sorted = [parts[0], parts[1]].sort();
      targetId = generateDeterministicUUID(`direct__${currentGid}__${sorted[0]}__${sorted[1]}`);
    }
  }

  if (window.roomMsgMapCache) {
    if (!window.roomMsgMapCache.has(targetId)) {
      window.roomMsgMapCache.set(targetId, []);
    }
    const arr = window.roomMsgMapCache.get(targetId);
    if (!arr.find(m => String(m.id) === String(newMsg.id))) {
      arr.unshift(newMsg);
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

  const chatView = document.getElementById("chatRoomView");
  const isInChatView = Boolean(chatView && chatView.style.display !== "none");
  const isViewingThisRoom = isInChatView && (window.currentActiveRoomId === targetId);

  if (isViewingThisRoom) {
    window.markRoomAsReadNow(targetId, [newMsg]);
  } else {
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

window.handleLeaveChatRoom = async function(roomId, roomTitle) {
  if (!roomId || roomId === "default_public") {
    alert("기본 전체 대화방은 나갈 수 없습니다.");
    return;
  }

  const confirmMsg = `[${roomTitle || '대화방'}] 에서 나가시겠습니까?\n목록에서 제거되며 대화방을 나옵니다.`;
  if (!confirm(confirmMsg)) return;

  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");
  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");

  try {
    if (typeof apiRequest === "function" && myNick) {
      try {
        await apiRequest(
          `room_members?guild_id=eq.${encodeURIComponent(currentGid)}&room_id=eq.${encodeURIComponent(roomId)}&member_nickname=eq.${encodeURIComponent(myNick)}`,
          "DELETE"
        );
      } catch(e) {}
    }

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
  const targetRoomId = roomId || "default_public";
  window.currentActiveRoomId = targetRoomId;
  window.currentActiveRoomType = roomType || ((targetRoomId && targetRoomId.includes('-')) ? 'direct' : 'public');
  window.currentActiveRoomTitle = roomTitle || '길드 대화방';

  // 입장 즉시 해당 방의 모든 메시지를 읽음 상태로 localStorage에 동기 저장
  window.markRoomAsReadNow(targetRoomId);

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
    btnLeave.style.display = (targetRoomId !== "default_public") ? "inline-flex" : "none";
  }

  if (typeof loadPastChatMessages === "function") {
    loadPastChatMessages(targetRoomId);
  }
};

window.exitChatRoomToMain = window.leaveChatRoomToMainTabs = function() {
  if (window.currentActiveRoomId && typeof window.markRoomAsReadNow === "function") {
    window.markRoomAsReadNow(window.currentActiveRoomId);
  }

  const mainView = document.getElementById("kakaoMainTabsView");
  const chatView = document.getElementById("chatRoomView");

  if (chatView) chatView.style.display = "none";
  if (mainView) mainView.style.display = "flex";
  document.body.classList.add("in-main-tabs");

  window.currentActiveRoomId = null;
  window.currentActiveRoomType = null;
  window.currentActiveRoomTitle = "";

  if (typeof window.switchMainBottomTab === 'function') {
    window.switchMainBottomTab("chats");
  }
};

// 1:1 개인 대화방 시작 (guild_id를 결정론적 UUID 시드에 포함하여 타 길드 동명이인 충돌 방지)
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
    const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
    const sortedNames = [myNick, targetNick].sort();
    const rawDirectKey = `direct__${currentGid}__${sortedNames[0]}__${sortedNames[1]}`;
    const newRoomId = generateDeterministicUUID(rawDirectKey);
    const roomTitle = `${sortedNames[0]} & ${sortedNames[1]} 1:1 톡방`;

    let leftRoomIds = [];
    try { leftRoomIds = JSON.parse(localStorage.getItem("left_chat_room_ids") || "[]"); } catch(e) {}
    if (leftRoomIds.includes(newRoomId)) {
      leftRoomIds = leftRoomIds.filter(id => id !== newRoomId);
      localStorage.setItem("left_chat_room_ids", JSON.stringify(leftRoomIds));
    }

    let localRooms = [];
    try { localRooms = JSON.parse(localStorage.getItem("local_custom_rooms") || "[]"); } catch(e) {}
    let existing = localRooms.find(r => r.id === newRoomId);
    if (!existing) {
      existing = {
        id: newRoomId,
        guild_id: currentGid,
        room_name: roomTitle,
        room_type: "direct",
        created_by: myNick,
        members: [myNick, targetNick],
        created_at: new Date().toISOString()
      };
      localRooms.push(existing);
      localStorage.setItem("local_custom_rooms", JSON.stringify(localRooms));
    }

    // DB의 chat_rooms 및 room_members 테이블에 guild_id를 필수로 포함하여 저장
    try {
      if (typeof apiRequest === "function") {
        const roomPayload = {
          id: newRoomId,
          guild_id: currentGid,
          room_name: roomTitle,
          room_type: "direct",
          created_by: myNick,
          members: [myNick, targetNick]
        };
        try {
          await apiRequest("chat_rooms", "POST", [roomPayload]);
        } catch (roomPostErr) {}

        try {
          await apiRequest("room_members", "POST", [
            { guild_id: currentGid, room_id: newRoomId, member_nickname: myNick, role: "member" },
            { guild_id: currentGid, room_id: newRoomId, member_nickname: targetNick, role: "member" }
          ]);
        } catch (e3) {}
      }
    } catch(dbErr) {}

    if (typeof showKakaoToast === "function") {
      showKakaoToast(`[${targetNick}] 님과의 1:1 대화방에 입장했습니다.`, "💬");
    }
    openChatRoom(newRoomId, roomTitle, "direct");
  } catch (err) {
    console.error("Direct chat error:", err);
    if (typeof showKakaoToast === "function") showKakaoToast("1:1 대화방 연결 실패: " + err.message, "⚠️");
  }
};

// --------------------------------------------------------
// 6. [설정 탭] 개인 환경설정 화면 로더
// --------------------------------------------------------
window.loadMainTabSettingsPage = async function() {
  const tabMore = document.getElementById("tabMoreContent");
  if (!tabMore) return;
  tabMore.innerHTML = `<div class="text-secondary small text-center py-4"><i class="fa-solid fa-spinner fa-spin me-2"></i>설정을 불러오는 중...</div>`;

  try {
    const res = await fetch(`pages/PageProfileSettings.html?_t=${Date.now()}`);
    if (!res.ok) throw new Error("로드 실패");
    const html = await res.text();
    tabMore.innerHTML = html;

    tabMore.querySelectorAll("script").forEach(s => {
      const sc = document.createElement("script");
      if (s.src) sc.src = s.src; else sc.textContent = s.textContent;
      document.body.appendChild(sc);
    });
  } catch(e) {
    tabMore.innerHTML = `<div class="text-danger small text-center py-4">설정 화면을 불러오지 못했습니다: ${e.message}</div>`;
  }
};

// --------------------------------------------------------
// 7. 모달 제어 전역 함수 보장 (직업 변경 시 guild_id 적용)
// --------------------------------------------------------
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
    } else if (role === "부길드장" || role === "부길마" || role === "수호") {
      badgeElem.innerHTML = `<span class="badge bg-primary text-white px-1 py-0 me-1" style="font-size:0.65rem;">${role === "수호" ? "수호" : "부길마"}</span>`;
    } else if (role === "정예") {
      badgeElem.innerHTML = '<span class="badge bg-info text-dark px-1 py-0 me-1" style="font-size:0.65rem;">정예</span>';
    } else {
      badgeElem.innerHTML = '<span class="badge bg-secondary bg-opacity-25 text-secondary px-1 py-0 me-1" style="font-size:0.65rem;">길드원</span>';
    }
  }

  if (actElem) {
    if (isMe) {
      actElem.innerHTML = `
        <button type="button" class="btn btn-warning btn-sm w-100 fw-bold py-2" style="background:#fee500; border:none; color:#191919; border-radius:8px; font-size:0.82rem;" onclick="closeMemberProfileCard(); openProfileEditModal();">
          <i class="fa-solid fa-pen me-1"></i>내 프로필 변경하기
        </button>
      `;
    } else {
      actElem.innerHTML = `
        <p class="text-secondary small mb-2 text-center" style="font-size:0.75rem;"><strong>${nick}</strong>님과 1:1 대화를 시작하시겠습니까?</p>
        <button type="button" class="btn btn-warning btn-sm w-100 fw-bold py-2 mb-1" style="background:#fee500; border:none; color:#191919; border-radius:8px; font-size:0.82rem;" onclick="closeMemberProfileCard(); startDirectChatWith('${nick}');">
          <i class="fa-solid fa-comment me-1"></i>1:1 대화하기
        </button>
      `;
    }
  }

  modal.style.display = "flex";
};
window.closeMemberProfileCard = function() {
  const modal = document.getElementById("modalMemberProfileCard");
  if (modal) modal.style.display = "none";
};

window.selectClassProfile = async function(icon, className) {
  let myCurrentNick = localStorage.getItem("guild_my_nickname") || "";
  let myCurrentClass = `${icon} ${className}`;
  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
  
  localStorage.setItem("guild_my_avatar", icon);
  localStorage.setItem("guild_my_class", myCurrentClass);

  const aIcon = document.getElementById("sidebarAvatarIcon");
  const uClass = document.getElementById("sidebarUserClassText");
  if (aIcon) aIcon.innerText = icon;
  if (uClass) uClass.innerText = myCurrentClass;

  const tabAvatar = document.getElementById("mainTabMyAvatar");
  const tabClass = document.getElementById("mainTabMyClass");
  if (tabAvatar) tabAvatar.innerText = icon;
  if (tabClass) tabClass.innerText = myCurrentClass;

  if (myCurrentNick && typeof apiRequest === "function") {
    try {
      await apiRequest(`guild_members?guild_id=eq.${encodeURIComponent(currentGid)}&name=eq.${encodeURIComponent(myCurrentNick)}`, "PATCH", {
        job_class: myCurrentClass,
        avatar: icon
      });
    } catch (e) {
      try {
        await apiRequest(`guild_members?guild_id=eq.${encodeURIComponent(currentGid)}&nickname=eq.${encodeURIComponent(myCurrentNick)}`, "PATCH", {
          job_class: myCurrentClass,
          avatar: icon
        });
      } catch (e2) {}
    }
  }
  closeProfileEditModal();
  if (typeof showKakaoToast === "function") {
    showKakaoToast(`직업이 [${className}] (으)로 변경되었습니다.`, icon);
  }
  if (typeof loadMainTabFriendsList === "function") {
    loadMainTabFriendsList();
  }
};

// --------------------------------------------------------
// 8. 새 대화방 개설 모달 제어 (guild_id 필수 포함)
// --------------------------------------------------------
window.openCreateRoomModal = function() {
  const modal = document.getElementById("modalCreateRoom");
  if (modal) modal.style.display = "flex";

  const titleInput = document.getElementById("newRoomTitleInput");
  if (titleInput) titleInput.value = "";

  const typeSelect = document.getElementById("newRoomTypeSelect");
  if (typeSelect) typeSelect.value = "group";

  onRoomTypeChange("group");
};

window.closeCreateRoomModal = function() {
  const modal = document.getElementById("modalCreateRoom");
  if (modal) modal.style.display = "none";
};

window.onRoomTypeChange = function(type) {
  const titleGroup = document.getElementById("roomTitleInputGroup");
  const targetGroup = document.getElementById("oneOnOneTargetGroup");
  const targetSelect = document.getElementById("oneOnOneTargetSelect");
  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");

  if (type === "one_on_one") {
    if (titleGroup) titleGroup.style.display = "none";
    if (targetGroup) targetGroup.style.display = "block";
    if (targetSelect) {
      const others = (window.cachedMemberList || []).filter(m => (m.nickname || m.name) !== myNick);
      targetSelect.innerHTML = others.map(m => {
        const name = m.nickname || m.name;
        return `<option value="${name}">${name}</option>`;
      }).join("");
    }
  } else {
    if (titleGroup) titleGroup.style.display = "block";
    if (targetGroup) targetGroup.style.display = "none";
  }
};

window.executeCreateNewRoom = async function() {
  const type = document.getElementById("newRoomTypeSelect").value;
  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "길드원");
  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");

  if (type === "one_on_one") {
    const targetSelect = document.getElementById("oneOnOneTargetSelect");
    const targetNick = targetSelect ? targetSelect.value : "";
    if (!targetNick) return alert("대화할 상대를 선택하세요.");
    closeCreateRoomModal();
    startDirectChatWith(targetNick);
    return;
  }

  const titleInput = document.getElementById("newRoomTitleInput");
  const title = (titleInput ? titleInput.value : "").trim();
  if (!title) return alert("대화방 이름을 입력하세요.");

  try {
    const newRoomUuid = generateDeterministicUUID(`custom_room__${currentGid}__${title}__${Date.now()}`);
    const roomPayload = {
      id: newRoomUuid,
      guild_id: currentGid,
      room_name: title,
      room_type: (type === "secret") ? "private" : "public",
      created_by: myNick
    };

    let newRoom = {
      id: newRoomUuid,
      guild_id: currentGid,
      room_name: title,
      room_type: roomPayload.room_type,
      created_by: myNick,
      created_at: new Date().toISOString()
    };

    if (typeof apiRequest === "function") {
      try {
        const res = await apiRequest("chat_rooms", "POST", [roomPayload]);
        if (res && res[0]) newRoom = res[0];
      } catch(e) {}
      try {
        await apiRequest("room_members", "POST", [{
          guild_id: currentGid,
          room_id: newRoom.id,
          member_nickname: myNick,
          role: "owner"
        }]);
      } catch(e2) {}
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

// --------------------------------------------------------
// 9. 실시간 대화방 생성 동기화 & 초기화 (타 길드 이벤트 무시)
// --------------------------------------------------------
window.initRoomsRealtime = function() {
  if (!window.supabaseClient) return;
  try {
    window.supabaseClient
      .channel("public:chat_rooms")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_rooms" }, (payload) => {
        const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
        if (payload.new && payload.new.guild_id && payload.new.guild_id !== currentGid) return;
        loadMainTabRoomsList();
      })
      .subscribe();
  } catch (e) {}
};

window.addEventListener("DOMContentLoaded", () => {
  initRoomsRealtime();
  if (typeof window.loadMainTabRoomsList === "function") {
    window.loadMainTabRoomsList();
  }
});

if (document.readyState === "complete" || document.readyState === "interactive") {
  setTimeout(() => {
    if (typeof window.loadMainTabRoomsList === "function") {
      window.loadMainTabRoomsList();
    }
  }, 50);
}
