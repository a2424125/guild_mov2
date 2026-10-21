// ========================================================
// [길드톡 메신저] 멀티 대화방 관리 엔진 (rooms.js)
// 3탭 네비게이션 / 톡방 개설 / 방별 격리 / 실시간 카운트
// ========================================================

window.currentActiveRoomId = null;
window.currentActiveRoomKey = "general";
window.cachedChatRoomsList = [];

// --------------------------------------------------------
// 1. 하단 3탭 전환 제어 (친구 | 채팅 | 더보기)
// --------------------------------------------------------
window.switchMainBottomTab = function(tabName) {
  const tabFriends = document.getElementById("tabFriendsContent");
  const tabChats = document.getElementById("tabChatRoomsContent") || document.getElementById("tabChatsContent");
  const tabMore = document.getElementById("tabMoreContent");

  const navFriends = document.getElementById("tabItemFriends") || document.getElementById("navTabFriends");
  const navChats = document.getElementById("tabItemChats") || document.getElementById("navTabChats");
  const navMore = document.getElementById("tabItemMore") || document.getElementById("navTabMore");

  const headerTitle = document.getElementById("mainTabHeaderTitle");
  const headerSubtitle = document.getElementById("mainTabHeaderSubtitle");
  const btnCreateRoom = document.getElementById("btnOpenCreateRoomModal");

  [navFriends, navChats, navMore].forEach(item => {
    if (item) item.classList.remove("active");
  });
  [tabFriends, tabChats, tabMore].forEach(content => {
    if (content) content.style.display = "none";
  });

  if (tabName === "friends") {
    if (navFriends) navFriends.classList.add("active");
    if (tabFriends) tabFriends.style.display = "block";
    if (headerTitle) headerTitle.innerText = "길드원";
    if (headerSubtitle) headerSubtitle.innerText = "친구 목록";
    if (btnCreateRoom) btnCreateRoom.style.display = "none";
    loadMainTabFriendsList();
  } else if (tabName === "more") {
    if (navMore) navMore.classList.add("active");
    if (tabMore) tabMore.style.display = "block";
    if (headerTitle) headerTitle.innerText = "더보기";
    if (headerSubtitle) headerSubtitle.innerText = "주요 기능 바로가기";
    if (btnCreateRoom) btnCreateRoom.style.display = "none";
  } else {
    if (navChats) navChats.classList.add("active");
    if (tabChats) tabChats.style.display = "block";
    if (headerTitle) headerTitle.innerText = "대화방 목록";
    if (headerSubtitle) headerSubtitle.innerText = "참여 중인 톡방";
    if (btnCreateRoom) btnCreateRoom.style.display = "inline-flex";
    loadMainTabRoomsList();
  }
};

// --------------------------------------------------------
// 2. [친구 탭] 길드원 리스트 렌더링 & 1:1 대화 시작
// --------------------------------------------------------
window.loadMainTabFriendsList = async function() {
  const container = document.getElementById("mainTabFriendsList") || document.getElementById("mainTabFriendsListArea");
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
    let members = [];
    const currentGid = localStorage.getItem("current_guild_id");

    if (typeof apiRequest === "function" && currentGid) {
      try {
        members = await apiRequest("guild_members?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*&order=nickname.asc");
      } catch (e) {
        try {
          members = await apiRequest("guild_members?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*&order=name.asc");
        } catch (e2) {}
      }
    }

    if (!members || members.length === 0) {
      if (!currentGid && typeof apiRequest === "function") {
        members = await apiRequest("guild_members?select=*&order=nickname.asc");
      }
    }

    window.cachedMemberList = members || [];

    const countElem = document.getElementById("mainTabMemberCount") || document.getElementById("mainTabFriendsCount");
    if (countElem) countElem.innerText = members.length;

    if (!members || members.length === 0) {
      container.innerHTML = `<div class="text-secondary small text-center py-4">등록된 길드원이 없습니다.</div>`;
      return;
    }

    container.innerHTML = members.map(m => {
      const mName = m.nickname || m.name || "길드원";
      const isMe = (m.nickname === myNick || m.name === myNick);
      const mAvatar = m.avatar_icon || m.avatar || "👤";
      const mClass = m.class_name || m.job_class || "직업 미지정";
      const mRole = m.role || "일반";

      let roleBadge = "";
      if (mRole === "길드장" || mRole === "길마") {
        roleBadge = `<span class="badge bg-warning text-dark px-1 py-0 me-1" style="font-size:0.62rem;">길마</span>`;
      } else if (mRole === "부길드장" || mRole === "부길마") {
        roleBadge = `<span class="badge bg-primary text-white px-1 py-0 me-1" style="font-size:0.62rem;">부길마</span>`;
      } else if (mRole === "정예") {
        roleBadge = `<span class="badge bg-info text-dark px-1 py-0 me-1" style="font-size:0.62rem;">정예</span>`;
      }

      return `
        <div class="chat-room-card" onclick="${isMe ? 'openProfileEditModal()' : `startDirectChatWith('${mName}')`}">
          <div class="room-card-avatar group" style="width: 40px; height: 40px; border-radius: 14px; font-size: 1.1rem;">${mAvatar}</div>
          <div class="room-card-info">
            <div class="d-flex align-items-center">
              ${roleBadge}
              <span class="room-card-title">${mName}</span>
              ${isMe ? '<span class="badge bg-secondary bg-opacity-25 text-secondary ms-1" style="font-size:0.6rem;">나</span>' : ''}
            </div>
            <div class="room-card-last-msg">${mClass}</div>
          </div>
          ${!isMe ? '<button type="button" class="btn btn-outline-warning btn-xs py-1 px-2" style="font-size:0.68rem; border-radius:6px;"><i class="fa-solid fa-comment-dots me-1"></i>1:1 대화</button>' : ''}
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("Friends list load error:", err);
    container.innerHTML = `<div class="text-danger small text-center py-4">길드원 목록을 불러오지 못했습니다.</div>`;
  }
};

// --------------------------------------------------------
// 3. [채팅 탭] 참여 중인 대화방 목록 로딩 (타 길드 방 유출 원천 차단)
// --------------------------------------------------------
window.loadMainTabRoomsList = async function() {
  const container = document.getElementById("mainTabRoomsList") || document.getElementById("mainTabRoomsListArea");
  if (!container) return;

  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");

  try {
    let rooms = [];
    const currentGid = localStorage.getItem("current_guild_id");
    let joined = [];
    try { joined = JSON.parse(localStorage.getItem("my_joined_guilds") || "[]"); } catch(e) {}
    const curGuild = joined.find(g => g.guild_id === currentGid);
    const guildTitle = (curGuild && curGuild.guild_name) ? `${curGuild.guild_name} 전체 대화방` : "길드 전체 대화방";

    // ⚡ 현재 길드 ID에 소속된 방만 엄격하게 조회 (다른 길드의 방 유출 폴백 완전 삭제)
    if (typeof apiRequest === "function" && currentGid) {
      try {
        rooms = await apiRequest("chat_rooms?guild_id=eq." + encodeURIComponent(currentGid) + "&select=*,room_members(*)&order=created_at.asc");
      } catch(e) {}
    }

    // 현재 길드에 생성된 방이 없으면 해당 길드의 기본 전체 공개방 1개만 안전 노출
    if (!rooms || rooms.length === 0) {
      rooms = [{
        id: "default_public",
        room_name: guildTitle,
        room_type: "public",
        created_at: new Date().toISOString()
      }];
    }

    // 필터링: 내가 참여할 수 있는 방인지 확인
    const myRooms = rooms.filter(r => {
      if (r.room_type === "public" || r.id === "default_public") return true;
      if (!r.room_members || r.room_members.length === 0) return true;
      return r.room_members.some(m => (m.member_nickname === myNick || m.nickname === myNick));
    });

    window.cachedChatRoomsList = myRooms;

    const countElem = document.getElementById("mainTabRoomCount");
    if (countElem) countElem.innerText = myRooms.length;

    container.innerHTML = myRooms.map(r => {
      let iconClass = "fa-users";
      let typeClass = "";
      let typeBadge = "";

      if (r.room_type === "private" || r.room_type === "secret") {
        iconClass = "fa-shield-halved";
        typeClass = "secret";
        typeBadge = `<span class="badge bg-danger bg-opacity-25 text-danger ms-1" style="font-size:0.6rem;">운영진</span>`;
      } else if (r.room_type === "direct" || r.room_type === "one_on_one") {
        iconClass = "fa-user";
        typeClass = "one-on-one";
        typeBadge = `<span class="badge bg-info bg-opacity-25 text-info ms-1" style="font-size:0.6rem;">1:1</span>`;
      } else {
        typeBadge = `<span class="badge bg-warning text-dark ms-1" style="font-size:0.6rem;">전체</span>`;
      }

      return `
        <div class="chat-room-card" onclick="openChatRoom('${r.id}', '${r.room_name}', '${r.room_type}')">
          <div class="room-card-avatar ${typeClass}">
            <i class="fa-solid ${iconClass}"></i>
          </div>
          <div class="room-card-info">
            <div class="room-card-top">
              <div class="d-flex align-items-center" style="min-width:0; flex:1;">
                <span class="room-card-title">${r.room_name}</span>
                ${typeBadge}
              </div>
              <span class="room-card-time">대화방 입장 <i class="fa-solid fa-chevron-right ms-1"></i></span>
            </div>
            <div class="room-card-bottom">
              <span class="room-card-last-msg">터치하여 대화방에 참여하세요.</span>
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
// 4. 개별 대화방 입장 및 퇴장
// --------------------------------------------------------
window.openChatRoom = function(roomId, roomTitle, roomType) {
  window.currentActiveRoomId = roomId;
  window.currentActiveRoomKey = (roomId === "default_public") ? "general" : String(roomId);

  const mainTabs = document.getElementById("mainTabsContainer") || document.getElementById("kakaoMainTabsView");
  const chatView = document.getElementById("singleChatRoomContainer") || document.getElementById("chatRoomView");

  if (mainTabs) mainTabs.style.display = "none";
  if (chatView) chatView.style.display = "flex";

  const titleElem = document.getElementById("chatRoomTitle");
  const avatarElem = document.getElementById("chatRoomAvatar");

  if (titleElem) titleElem.innerText = roomTitle || "길드 대화방";
  if (avatarElem) {
    if (roomType === "private" || roomType === "secret") {
      avatarElem.innerHTML = `<i class="fa-solid fa-shield-halved text-danger"></i>`;
    } else if (roomType === "direct" || roomType === "one_on_one") {
      avatarElem.innerHTML = `<i class="fa-solid fa-user text-info"></i>`;
    } else {
      avatarElem.innerHTML = `<i class="fa-solid fa-users"></i>`;
    }
  }

  if (typeof loadPastChatMessages === "function") {
    loadPastChatMessages();
  }
};

window.exitChatRoomToMain = function() {
  const mainTabs = document.getElementById("mainTabsContainer") || document.getElementById("kakaoMainTabsView");
  const chatView = document.getElementById("singleChatRoomContainer") || document.getElementById("chatRoomView");

  if (chatView) chatView.style.display = "none";
  if (mainTabs) mainTabs.style.display = "flex";

  window.currentActiveRoomId = null;
  window.currentActiveRoomKey = "general";

  switchMainBottomTab("chats");
};
window.leaveChatRoomToMainTabs = window.exitChatRoomToMain;

// --------------------------------------------------------
// 5. 1:1 대화방 개설 및 진입 로직
// --------------------------------------------------------
window.startDirectChatWith = async function(targetNick) {
  const myNick = localStorage.getItem("guild_my_nickname") || "";
  if (!myNick) {
    if (typeof openWelcomeGatewayModal === "function") openWelcomeGatewayModal();
    else if (typeof showGuildLoginModal === "function") showGuildLoginModal();
    return;
  }
  if (myNick === targetNick) {
    return showKakaoToast("본인과는 1:1 대화를 할 수 없습니다.", "⚠️");
  }

  const currentGid = localStorage.getItem("current_guild_id");
  const roomName = `${targetNick} & ${myNick} 1:1 톡방`;

  try {
    let existingRoom = null;
    if (window.cachedChatRoomsList && window.cachedChatRoomsList.length > 0) {
      existingRoom = window.cachedChatRoomsList.find(r => 
        (r.room_type === "direct" || r.room_type === "one_on_one") && 
        r.room_members && 
        r.room_members.some(m => (m.member_nickname === targetNick || m.nickname === targetNick))
      );
    }

    if (existingRoom) {
      openChatRoom(existingRoom.id, existingRoom.room_name, existingRoom.room_type);
      return;
    }

    const res = await apiRequest("chat_rooms", "POST", [{
      guild_id: currentGid,
      room_name: roomName,
      room_type: "direct",
      created_by: myNick
    }]);

    const newRoomId = (res && res[0]) ? res[0].id : null;
    if (newRoomId) {
      await apiRequest("room_members", "POST", [
        { room_id: newRoomId, member_nickname: myNick, role: "owner" },
        { room_id: newRoomId, member_nickname: targetNick, role: "member" }
      ]);
    }

    showKakaoToast(`[${targetNick}] 님과의 1:1 대화방이 생성되었습니다.`, "💬");
    await loadMainTabRoomsList();
    openChatRoom(newRoomId, roomName, "direct");
  } catch (err) {
    console.error("Direct chat error:", err);
    showKakaoToast("1:1 대화방 개설 실패: " + err.message, "⚠️");
  }
};

// --------------------------------------------------------
// 6. 새 대화방 생성 모달 연동
// --------------------------------------------------------
window.openCreateRoomModal = function() {
  const modal = document.getElementById("modalCreateRoom");
  if (modal) modal.style.display = "flex";

  const select = document.getElementById("oneOnOneTargetSelect");
  if (select && window.cachedMemberList) {
    const myNick = localStorage.getItem("guild_my_nickname") || "";
    select.innerHTML = window.cachedMemberList
      .filter(m => (m.nickname || m.name) !== myNick)
      .map(m => {
        const n = m.nickname || m.name;
        return `<option value="${n}">${n} (${m.role || '일반'})</option>`;
      })
      .join("");
  }
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
  const myRole = localStorage.getItem("guild_my_role") || "일반";
  const currentGid = localStorage.getItem("current_guild_id");

  const type = document.getElementById("newRoomTypeSelect").value;
  let title = (document.getElementById("newRoomTitleInput").value || "").trim();
  const targetNick = (document.getElementById("oneOnOneTargetSelect")?.value || "").trim();

  if (type === "one_on_one") {
    if (!targetNick) return showKakaoToast("대화할 상대를 선택하세요.", "⚠️");
    closeCreateRoomModal();
    startDirectChatWith(targetNick);
    return;
  }

  if (!title) return showKakaoToast("대화방 이름을 입력하세요.", "⚠️");

  if (type === "secret") {
    const isMaster = (myRole === "길드장" || myRole === "길마" || myRole === "부길드장" || myRole === "부길마");
    if (!isMaster) {
      return showKakaoToast("운영진 비밀 대화방은 운영진만 개설할 수 있습니다.", "⚠️");
    }
  }

  try {
    const res = await apiRequest("chat_rooms", "POST", [{
      guild_id: currentGid,
      room_name: title,
      room_type: type,
      created_by: myNick
    }]);

    const newRoomId = (res && res[0]) ? res[0].id : null;
    if (newRoomId) {
      await apiRequest("room_members", "POST", [
        { room_id: newRoomId, member_nickname: myNick, role: "owner" }
      ]);
    }

    closeCreateRoomModal();
    showKakaoToast(`[${title}] 대화방이 개설되었습니다.`, "🎉");
    await loadMainTabRoomsList();
  } catch (err) {
    showKakaoToast("방 개설 실패: " + err.message, "⚠️");
  }
};

// --------------------------------------------------------
// 7. 실시간 대화방 생성/삭제 구독 (Realtime)
// --------------------------------------------------------
window.initRoomsRealtime = function() {
  if (!window.supabaseClient) return;

  const currentGid = localStorage.getItem("current_guild_id") || "";
  const filterStr = currentGid ? `guild_id=eq.${currentGid}` : undefined;

  window.supabaseClient
    .channel("public:chat_rooms")
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "chat_rooms",
      filter: filterStr
    }, () => {
      loadMainTabRoomsList();
    })
    .subscribe();
};

// --------------------------------------------------------
// 8. 길드 개설 실행 (네이티브 alert 전면 제거 & 커스텀 안내 연동)
// --------------------------------------------------------
window.executeActivateGuild = async function() {
  const keyInput = (document.getElementById("actLicenseKeyInput")?.value || "").trim().toUpperCase();
  const masterNick = (document.getElementById("actMasterNickInput")?.value || "").trim();
  const pinInput = (document.getElementById("actPinInput")?.value || "").trim();

  if (!keyInput) return showKakaoToast("라이선스 키를 입력해 주세요.", "⚠️");
  if (!masterNick) return showKakaoToast("길드장 닉네임을 입력해 주세요.", "⚠️");
  if (!pinInput || pinInput.length < 6) return showKakaoToast("길드장 비밀번호(6자리 PIN)를 입력해 주세요.", "⚠️");

  try {
    const licenses = await apiRequest(`app_licenses?license_key=eq.${encodeURIComponent(keyInput)}`);
    if (!licenses || licenses.length === 0) {
      return showKakaoToast("유효하지 않은 라이선스 키입니다.", "⚠️");
    }
    const lic = licenses[0];
    if (lic.status === "expired" || lic.status === "suspended") {
      return showKakaoToast("해당 라이선스는 현재 만료되었거나 정지 상태입니다.", "⚠️");
    }

    const guildId = lic.guild_id || `guild_${Date.now()}`;

    const existingGuilds = await apiRequest(`guilds?id=eq.${encodeURIComponent(guildId)}`);
    if (!existingGuilds || existingGuilds.length === 0) {
      await apiRequest("guilds", "POST", [{
        id: guildId,
        name: lic.guild_name || "길드",
        game_name: lic.game_name || "게임",
        license_key: keyInput,
        invite_code: lic.invite_code || ("INV-" + Math.floor(100000 + Math.random() * 900000)),
        status: "active"
      }]);
    }

    try {
      await apiRequest("guild_members", "POST", [{
        guild_id: guildId,
        nickname: masterNick,
        name: masterNick,
        role: "길드장",
        pin: pinInput
      }]);
    } catch(mErr) {
      try {
        await apiRequest("guild_members", "POST", [{
          guild_id: guildId,
          name: masterNick,
          role: "길드장",
          pin: pinInput
        }]);
      } catch(mErr2) {}
    }

    await apiRequest("app_licenses?id=eq." + lic.id, "PATCH", {
      status: "active",
      activated_at: new Date().toISOString()
    });

    const roomCheck = await apiRequest(`chat_rooms?guild_id=eq.${encodeURIComponent(guildId)}&room_name=eq.${encodeURIComponent(`${lic.guild_name || "길드"} 전체 대화방`)}`);
    if (!roomCheck || roomCheck.length === 0) {
      await apiRequest("chat_rooms", "POST", [{
        guild_id: guildId,
        room_name: `${lic.guild_name || "길드"} 전체 대화방`,
        room_type: "public",
        created_by: masterNick
      }]);
    }

    localStorage.setItem("current_guild_id", guildId);
    localStorage.setItem("guild_my_nickname", masterNick);
    localStorage.setItem("guild_my_pin", pinInput);
    localStorage.setItem("guild_my_role", "길드장");
    sessionStorage.setItem("admin_auth", "true");
    sessionStorage.setItem("admin_role", "admin");

    let joinedGuilds = [];
    try { joinedGuilds = JSON.parse(localStorage.getItem("my_joined_guilds") || "[]"); } catch(e) {}
    joinedGuilds = joinedGuilds.filter(g => g.guild_id !== guildId);
    joinedGuilds.push({
      guild_id: guildId,
      guild_name: lic.guild_name || "길드",
      game_name: lic.game_name || "게임",
      nickname: masterNick,
      role: "길드장",
      invite_code: lic.invite_code || keyInput
    });
    localStorage.setItem("my_joined_guilds", JSON.stringify(joinedGuilds));

    if (typeof closeActivateGuildModal === "function") closeActivateGuildModal();

    const successModal = document.getElementById("modalLicenseSuccess");
    if (successModal) {
      const h6 = successModal.querySelector("h6");
      const p = successModal.querySelector("p");
      if (h6) h6.innerText = `[${lic.guild_name}] 길드 개설 완료!`;
      if (p) p.innerHTML = `길드가 성공적으로 활성화되었습니다.<br><strong>${masterNick}</strong>님으로 자동 로그인되었습니다.`;
      successModal.style.display = "flex";
    } else {
      if (typeof showKakaoToast === "function") {
        showKakaoToast(`[${lic.guild_name}] 길드가 개설되었습니다! (${masterNick} 로그인)`, "👑");
      }
      setTimeout(() => location.reload(), 600);
    }
  } catch (err) {
    console.error("Activate guild error:", err);
    showKakaoToast("길드 개설 실패: " + err.message, "⚠️");
  }
};

// --------------------------------------------------------
// 9. 페이지 로드 시 초기화
// --------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    if (typeof initRoomsRealtime === "function") initRoomsRealtime();
    if (typeof switchMainBottomTab === "function") switchMainBottomTab("chats");
  }, 100);
});
