// ========================================================
// [길드톡 메신저] 카카오톡 스타일 메인 3탭 & 다중 톡방 관리 모듈 (rooms.js)
// 친구 목록 / 대화방 목록 / 더보기 탭 제어 및 방 개설(운영진방, 1:1 개인톡)
// ========================================================

window.currentActiveRoomId = null;
window.cachedChatRoomsList = [];

// --------------------------------------------------------
// 1. 하단 3탭 전환 제어 (친구 / 채팅 / 더보기)
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
// 2. [친구 탭] 길드원 리스트 렌더링 & 1:1 대화 시작
// --------------------------------------------------------
window.loadMainTabFriendsList = async function() {
  const container = document.getElementById("mainTabFriendsList");
  if (!container) return;

  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");
  const myAvatar = localStorage.getItem("guild_my_avatar") || "👤";
  const myClass = localStorage.getItem("guild_my_class") || "직업 설정하기";

  // 내 프로필 카드 동기화
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
          if (!currentGid) {
            members = await apiRequest("guild_members?select=*&order=nickname.asc");
          }
        }
        window.cachedMemberList = members || [];
      }
    }

    const countElem = document.getElementById("mainTabMemberCount");
    if (countElem) countElem.innerText = members.length;

    if (!members || members.length === 0) {
      container.innerHTML = `<div class="text-secondary small text-center py-4">등록된 길드원이 없습니다.</div>`;
      return;
    }

    container.innerHTML = members.map(m => {
      const mName = m.nickname || m.name || "길드원";
      const isMe = (m.nickname === myNick || m.name === myNick);
      const mAvatar = m.avatar_icon || m.avatar || "👤";
      const mClass = m.class_name || m.job_class || "클래스 미지정";
      const mRole = m.role || "일반";

      let roleBadge = "";
      if (mRole === "길드장" || mRole === "길마") {
        roleBadge = `<span class="badge bg-warning text-dark px-1 py-0 me-1" style="font-size:0.62rem;">길마</span>`;
      } else if (mRole === "부길드장" || mRole === "부길마") {
        roleBadge = `<span class="badge bg-primary text-white px-1 py-0 me-1" style="font-size:0.62rem;">부길마</span>`;
      } else if (mRole === "정예") {
        roleBadge = `<span class="badge bg-info text-dark px-1 py-0 me-1" style="font-size:0.62rem;">정예</span>`;
      }

      // 길드원 클릭 시 1:1 대화 모달 호출
      const clickAction = isMe ? "openProfileEditModal()" : `confirmDirectChat('${mName}', '${mAvatar}', '${mClass}', '${mRole}')`;

      return `
        <div class="friend-item-card" onclick="${clickAction}">
          <div class="friend-avatar">${mAvatar}</div>
          <div class="room-content-box">
            <div class="d-flex align-items-center" style="gap: 4px;">
              ${roleBadge}
              <span class="room-name-text">${mName}</span>
              ${isMe ? '<span class="badge bg-secondary bg-opacity-25 text-secondary ms-1" style="font-size:0.6rem;">나</span>' : ''}
            </div>
            <p class="room-msg-preview">${mClass}</p>
          </div>
          ${!isMe ? '<i class="fa-regular fa-comment text-secondary" style="font-size:0.85rem;"></i>' : '<i class="fa-solid fa-pen text-secondary" style="font-size:0.75rem;"></i>'}
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("Friends list load error:", err);
    container.innerHTML = `<div class="text-danger small text-center py-4">길드원 목록을 불러오지 못했습니다.</div>`;
  }
};

// 1:1 대화 의사 확인 팝업
window.confirmDirectChat = function(targetNick, avatar, className, role) {
  if (typeof window.openMemberProfileCard === "function") {
    window.openMemberProfileCard(targetNick, avatar, className, role);
    return;
  }
  if (confirm(`[${targetNick}] 님과 1:1 대화를 시작하시겠습니까?`)) {
    startDirectChatWith(targetNick);
  }
};

// --------------------------------------------------------
// 3. [채팅 탭] 참여 중인 대화방 목록 로딩 & 렌더링 (컴팩트 카카오 스타일)
// --------------------------------------------------------
window.loadMainTabRoomsList = async function() {
  const container = document.getElementById("mainTabRoomsList");
  if (!container) return;

  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");

  try {
    let rooms = [];
    const currentGid = localStorage.getItem("current_guild_id");
    let joined = [];
    try { joined = JSON.parse(localStorage.getItem("my_joined_guilds") || "[]"); } catch(e) {}
    const curGuild = joined.find(g => g.guild_id === currentGid);
    const guildTitle = (curGuild && curGuild.guild_name) ? `${curGuild.guild_name} 전체 대화방` : "길드 전체 대화방";

    if (typeof apiRequest === "function" && currentGid) {
      try {
        rooms = await apiRequest("chat_rooms?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*,room_members(*)&order=created_at.asc");
      } catch(e) {}
    }

    if (!rooms || rooms.length === 0) {
      rooms = [{
        id: "default_public",
        room_name: guildTitle,
        room_type: "public",
        created_at: new Date().toISOString()
      }];
    }

    const myRooms = rooms.filter(r => {
      if (r.room_type === "public") return true;
      if (!r.room_members || r.room_members.length === 0) return true;
      return r.room_members.some(m => (m.member_nickname === myNick || m.nickname === myNick));
    });

    window.cachedChatRoomsList = myRooms;

    const countElem = document.getElementById("mainTabRoomCount");
    if (countElem) countElem.innerText = myRooms.length;

    // 카카오톡 PC 형태의 깔끔한 컴팩트 레이아웃
    container.innerHTML = myRooms.map(r => {
      let iconClass = "fa-users";
      let typeClass = "";
      let typeBadge = "";

      if (r.room_type === "private") {
        iconClass = "fa-shield-halved";
        typeClass = "private";
        typeBadge = `<span class="badge bg-danger bg-opacity-25 text-danger ms-1" style="font-size:0.6rem;">운영진</span>`;
      } else if (r.room_type === "direct") {
        iconClass = "fa-user-tag";
        typeClass = "direct";
        typeBadge = `<span class="badge bg-info bg-opacity-25 text-info ms-1" style="font-size:0.6rem;">1:1</span>`;
      } else {
        typeBadge = `<span class="badge bg-warning bg-opacity-25 text-warning ms-1" style="font-size:0.6rem;">전체</span>`;
      }

      return `
        <div class="chat-room-card" onclick="openChatRoom('${r.id}', '${r.room_name}', '${r.room_type}')">
          <div class="room-avatar-large ${typeClass}">
            <i class="fa-solid ${iconClass}"></i>
          </div>
          <div class="room-content-box">
            <div class="d-flex align-items-center justify-content-between" style="margin-bottom: 2px;">
              <div class="d-flex align-items-center" style="min-width:0; flex:1;">
                <span class="room-name-text">${r.room_name}</span>
                ${typeBadge}
              </div>
              <span class="room-time-text" style="font-size: 0.68rem; color: #94a3b8;"><i class="fa-solid fa-chevron-right"></i></span>
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
// 4. 개별 대화방 입장 및 퇴장
// --------------------------------------------------------
window.openChatRoom = function(roomId, roomTitle, roomType) {
  window.currentActiveRoomId = roomId;

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

  window.currentActiveRoomId = null;
  if (typeof window.switchMainBottomTab === 'function') {
    window.switchMainBottomTab("chats");
  }
};

// --------------------------------------------------------
// 5. 1:1 개인톡 생성 및 즉시 입장
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
    const directRooms = (window.cachedChatRoomsList || []).filter(r => r.room_type === "direct");
    const existing = directRooms.find(r => {
      const names = (r.room_name || "");
      return names.includes(myNick) && names.includes(targetNick);
    });

    if (existing) {
      openChatRoom(existing.id, existing.room_name, "direct");
      return;
    }

    const currentGid = localStorage.getItem("current_guild_id") || "default_guild";
    const roomTitle = `${myNick}, ${targetNick} 1:1`;
    const newRoomId = "direct_" + Date.now();

    if (typeof apiRequest === "function") {
      await apiRequest("chat_rooms", "POST", [{
        id: newRoomId,
        guild_id: currentGid,
        room_name: roomTitle,
        room_type: "direct",
        created_by: myNick
      }]);

      await apiRequest("room_members", "POST", [
        { room_id: newRoomId, member_nickname: myNick },
        { room_id: newRoomId, member_nickname: targetNick }
      ]);
    }

    if (typeof showKakaoToast === "function") showKakaoToast(`[${targetNick}] 님과의 1:1 대화방이 개설되었습니다.`, "💬");
    openChatRoom(newRoomId, roomTitle, "direct");
    loadMainTabRoomsList();
  } catch (err) {
    console.error("Direct chat start error:", err);
    if (typeof showKakaoToast === "function") showKakaoToast("1:1 대화방 생성 실패: " + err.message, "❌");
  }
};
