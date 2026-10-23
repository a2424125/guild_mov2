// ========================================================
// [길드톡 메신저] 카카오톡 스타일 메인 3탭 & 다중 톡방 관리 모듈 (rooms.js)
// 친구 목록 / 대화방 목록 / 개인설정 탭 제어 및 방 개설(운영진방, 1:1 개인톡)
// ========================================================

window.currentActiveRoomId = "default_public";
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
    // 기본값: chats (대화방 목록)
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
      if (typeof apiRequest === "function") {
        const currentGid = localStorage.getItem("current_guild_id");
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
          try {
            members = await apiRequest("guild_members?select=*");
          } catch(e3) {}
        }
        window.cachedMemberList = members || [];
      }
    }

    const countElem = document.getElementById("mainTabMemberCount");
    if (countElem) countElem.innerText = members.length;

    container.innerHTML = members.map(m => {
      const mName = m.nickname || m.name || "길드원";
      const mRole = m.role || "일반";
      const mClass = m.job_class || m.class_name || "직업 미설정";
      const mAvatar = (m.avatar && m.avatar !== "👤") ? m.avatar : (mClass.split(" ")[0] || "👤");
      const isMe = (mName === myNick);

      let roleBadge = "";
      if (mRole === "길드장" || mRole === "길마") {
        roleBadge = '<span class="badge bg-warning text-dark px-1 py-0 me-1" style="font-size:0.6rem;">길마</span>';
      } else if (mRole === "부길드장" || mRole === "부길마") {
        roleBadge = '<span class="badge bg-primary text-white px-1 py-0 me-1" style="font-size:0.6rem;">부길마</span>';
      } else if (mRole === "정예") {
        roleBadge = '<span class="badge bg-info text-dark px-1 py-0 me-1" style="font-size:0.6rem;">정예</span>';
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
// 3. [대화방 탭] 대화방 목록 렌더링 (1:1 방 영구 보존 및 복원)
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

    // 2) 로컬 보존 1:1 대화방 및 생성 대화방 복원 (증발 방지 핵심)
    let localRooms = [];
    try { localRooms = JSON.parse(localStorage.getItem("local_custom_rooms") || "[]"); } catch(e) {}

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

      return `
        <div class="chat-room-card" onclick="openChatRoom('${r.id}', '${safeRoomName}', '${r.room_type}')">
          <div class="room-avatar-large ${typeClass}">
            <i class="fa-solid ${iconClass}"></i>
          </div>
          <div class="room-content-box">
            <div class="room-title-row">
              <div class="d-flex align-items-center" style="min-width:0; flex:1;">
                <span class="room-name-text">${r.room_name}</span>
                ${typeBadge}
              </div>
              ${(r.id !== "default_public") ? `
                <div class="d-flex align-items-center gap-1" onclick="event.stopPropagation();">
                  <button type="button" class="btn btn-outline-danger btn-xs py-1 px-2" style="font-size:0.68rem; border-radius:6px; font-weight:600; line-height:1.2;" onclick="handleLeaveChatRoom('${r.id}', '${safeRoomName}')" title="대화방 나가기">
                    <i class="fa-solid fa-arrow-right-from-bracket me-1"></i>방 나오기
                  </button>
                  <span class="room-time-text ms-1" style="cursor:pointer;" onclick="openChatRoom('${r.id}', '${safeRoomName}', '${r.room_type}')">입장 <i class="fa-solid fa-chevron-right ms-1"></i></span>
                </div>
              ` : `
                <span class="room-time-text">입장 <i class="fa-solid fa-chevron-right ms-1"></i></span>
              `}
            </div>
            <p class="room-msg-preview">터치하여 대화방에 참여하세요.</p>
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
// [대화방 나가기 / 방 나오기] (1:1 톡방 및 개설 대화방 목록에서 제거)
// --------------------------------------------------------
window.handleLeaveChatRoom = async function(roomId, roomTitle) {
  if (!roomId || roomId === "default_public") {
    alert("기본 전체 대화방은 나갈 수 없습니다.");
    return;
  }

  const confirmMsg = `[${roomTitle || '대화방'}] 에서 나가시겠습니까?\n목록에서 제거되며 대화방을 나옵니다.`;
  if (!confirm(confirmMsg)) return;

  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");

  try {
    if (typeof apiRequest === "function" && myNick) {
      try {
        await apiRequest(`room_members?room_id=eq.${encodeURIComponent(roomId)}&member_nickname=eq.${encodeURIComponent(myNick)}`, "DELETE");
      } catch(e) {}
    }

    let leftRoomIds = [];
    try { leftRoomIds = JSON.parse(localStorage.getItem("left_chat_room_ids") || "[]"); } catch(e) {}
    if (!leftRoomIds.includes(roomId)) {
      leftRoomIds.push(roomId);
      localStorage.setItem("left_chat_room_ids", JSON.stringify(leftRoomIds));
    }

    // 로컬 보존 목록에서도 해제
    let localRooms = [];
    try { localRooms = JSON.parse(localStorage.getItem("local_custom_rooms") || "[]"); } catch(e) {}
    localRooms = localRooms.filter(r => r.id !== roomId);
    localStorage.setItem("local_custom_rooms", JSON.stringify(localRooms));

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
  window.currentActiveRoomId = roomId || "default_public";

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

  const btnLeave = document.getElementById("btnLeaveCurrentRoom");
  if (btnLeave) {
    btnLeave.style.display = (roomId && roomId !== "default_public") ? "inline-flex" : "none";
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

  window.currentActiveRoomId = "default_public";
  if (typeof window.switchMainBottomTab === 'function') {
    window.switchMainBottomTab("chats");
  }
};

// --------------------------------------------------------
// 5. 1:1 개인톡 즉시 생성 및 입장 (길드원끼리만 허용 & 영구 보존)
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
    // 안정적인 1:1 방 고유 식별자 생성
    const sortedPair = [myNick, targetNick].sort().join("_");
    const newRoomId = "direct_" + sortedPair;
    const roomTitle = `${myNick} & ${targetNick} 1:1 톡방`;

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
    } catch(dbErr) {
      console.warn("Direct chat DB insert error (fallback to local):", dbErr);
    }

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
// 7. 길드원 미니 프로필 카드 및 1:1 시작
// --------------------------------------------------------
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
  
  localStorage.setItem("guild_my_avatar", icon);
  localStorage.setItem("guild_my_class", myCurrentClass);

  const mainAvatar = document.getElementById("mainTabMyAvatar");
  const mainClass = document.getElementById("mainTabMyClass");
  if (mainAvatar) mainAvatar.innerText = icon;
  if (mainClass) mainClass.innerText = myCurrentClass;

  const aIcon = document.getElementById("sidebarAvatarIcon");
  const uClass = document.getElementById("sidebarUserClassText");
  if (aIcon) aIcon.innerText = icon;
  if (uClass) uClass.innerText = myCurrentClass;

  if (myCurrentNick && typeof apiRequest === "function") {
    try {
      await apiRequest(`guild_members?name=eq.${encodeURIComponent(myCurrentNick)}`, "PATCH", {
        job_class: myCurrentClass,
        avatar: icon
      });
    } catch (e) {}
  }
  
  const modal = document.getElementById("modalProfileEdit");
  if (modal) modal.style.display = "none";
  if (typeof showKakaoToast === "function") showKakaoToast(`직업이 [${className}] (으)로 변경되었습니다.`, icon);
  if (typeof loadMainTabFriendsList === "function") loadMainTabFriendsList();
};

// --------------------------------------------------------
// 8. 새 대화방 개설 모달 제어
// --------------------------------------------------------
window.openCreateRoomModal = function() {
  const modal = document.getElementById("modalCreateRoom");
  if (!modal) return;

  const titleInput = document.getElementById("newRoomTitleInput");
  if (titleInput) titleInput.value = "";

  const typeSelect = document.getElementById("newRoomTypeSelect");
  if (typeSelect) typeSelect.value = "group";

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
  const targetSelect = document.getElementById("oneOnOneTargetSelect");

  if (type === "one_on_one") {
    if (titleGroup) titleGroup.style.display = "none";
    if (targetGroup) targetGroup.style.display = "block";

    if (targetSelect) {
      const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");
      const friends = (window.cachedMemberList || []).filter(m => (m.nickname !== myNick && m.name !== myNick));
      targetSelect.innerHTML = friends.map(m => {
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
  const currentGid = localStorage.getItem("current_guild_id");

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
    const roomPayload = {
      room_name: title,
      room_type: (type === "secret") ? "private" : "public",
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
  } catch (e) {}
};

window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    initRoomsRealtime();
    switchMainBottomTab("chats");
  }, 100);
});
