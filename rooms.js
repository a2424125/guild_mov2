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

      return `
        <div class="friend-item-card" onclick="openMemberProfileCard('${mName}', '${mAvatar}', '${mClass}', '${mRole}')">
          <div class="friend-avatar">${mAvatar}</div>
          <div class="room-content-box">
            <div class="d-flex align-items-center" style="gap: 4px;">
              ${roleBadge}
              <span class="room-name-text">${mName}</span>
              ${isMe ? '<span class="badge bg-secondary bg-opacity-25 text-secondary ms-1" style="font-size:0.6rem;">나</span>' : ''}
            </div>
            <p class="room-msg-preview">${mClass}</p>
          </div>
          ${!isMe ? '<button type="button" class="btn btn-outline-warning btn-xs py-1 px-2" style="font-size:0.68rem; border-radius:5px;" onclick="event.stopPropagation(); startDirectChatWith(\'' + mName + '\');"><i class="fa-solid fa-comment-dots me-1"></i>1:1 대화</button>' : ''}
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("Friends list load error:", err);
    container.innerHTML = `<div class="text-danger small text-center py-4">길드원 목록을 불러오지 못했습니다.</div>`;
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

    // 현재 길드에 생성된 방이 없으면 해당 길드의 기본 전체 공개방 1개만 안전하게 노출 (타 길드 방 절대 유출 금지)
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
      if (r.room_type === "public") return true;
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
            <div class="room-title-row">
              <div class="d-flex align-items-center" style="min-width:0; flex:1;">
                <span class="room-name-text">${r.room_name}</span>
                ${typeBadge}
              </div>
              <span class="room-time-text">대화방 입장 <i class="fa-solid fa-chevron-right ms-1"></i></span>
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
// 4. 개별 대화방 입장 및 퇴장 (화면 전환 & 메뉴 토글)
// --------------------------------------------------------
window.openChatRoom = function(roomId, roomTitle, roomType) {
  window.currentActiveRoomId = roomId;

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

  window.currentActiveRoomId = null;
  if (typeof window.switchMainBottomTab === 'function') {
    window.switchMainBottomTab("chats");
  }
};

// --------------------------------------------------------
// 5. 1:1 개인톡 즉시 생성 및 입장 (길드원끼리만 허용)
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

    const roomTitle = `${myNick} & ${targetNick} 1:1 톡방`;
    const createRes = await apiRequest("chat_rooms", "POST", [{
      room_name: roomTitle,
      room_type: "direct",
      created_by: myNick
    }]);

    if (!createRes || !createRes[0]) throw new Error("1:1 방 생성 실패");
    const newRoom = createRes[0];

    await apiRequest("room_members", "POST", [
      { room_id: newRoom.id, member_nickname: myNick, role: "member" },
      { room_id: newRoom.id, member_nickname: targetNick, role: "member" }
    ]);

    if (typeof showKakaoToast === "function") showKakaoToast(`${targetNick}님과의 1:1 대화방이 개설되었습니다!`, "💬");
    openChatRoom(newRoom.id, roomTitle, "direct");
  } catch (err) {
    console.error("Direct chat error:", err);
    alert("1:1 대화방 개설 실패: " + err.message);
  }
};

// --------------------------------------------------------
// 6. 새 대화방 개설 모달 제어 (길드장 권한 체크)
// --------------------------------------------------------
window.openCreateRoomModal = function() {
  const modal = document.getElementById("modalCreateRoom");
  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");
  const myRole = localStorage.getItem("guild_my_role") || "일반";

  if (modal) modal.style.display = "flex";

  const titleInput = document.getElementById("newRoomTitleInput");
  if (titleInput) titleInput.value = "";

  const typeSelect = document.getElementById("newRoomTypeSelect");
  if (typeSelect) typeSelect.value = "public";

  onRoomTypeChange("public");

  const listContainer = document.getElementById("roomMemberCheckList");
  if (listContainer) {
    const members = (window.cachedMemberList || []).filter(m => {
      const name = m.name || m.nickname;
      return name !== myNick;
    });

    if (members.length === 0) {
      listContainer.innerHTML = `<span class="text-secondary small">참여 가능한 다른 길드원이 없습니다.</span>`;
    } else {
      listContainer.innerHTML = members.map(m => {
        const name = m.name || m.nickname;
        return `
          <label class="d-flex align-items-center gap-2 py-1" style="cursor:pointer; font-size:0.75rem;">
            <input type="checkbox" name="createRoomMember" value="${name}">
            <span>${name}</span>
          </label>
        `;
      }).join("");
    }
  }
};

window.closeCreateRoomModal = function() {
  const modal = document.getElementById("modalCreateRoom");
  if (modal) modal.style.display = "none";
};

window.onRoomTypeChange = function(type) {
  const area = document.getElementById("roomMemberSelectArea");
  if (!area) return;
  if (type === "public") {
    area.style.display = "none";
  } else {
    area.style.display = "block";
  }
};

window.executeCreateRoom = async function() {
  const title = (document.getElementById("newRoomTitleInput").value || "").trim();
  const type = document.getElementById("newRoomTypeSelect").value;
  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "길드원");
  const myRole = localStorage.getItem("guild_my_role") || "일반";

  // 길드장이 아닌 일반 길드원이 그룹방(전체/운영진)을 만들려고 할 때 방어
  const isGuildMaster = (myRole === "길드장" || myRole === "길마" || sessionStorage.getItem("admin_role") === "super" || sessionStorage.getItem("admin_role") === "admin");
  if (type !== "direct" && !isGuildMaster) {
    return alert("운영진방 및 그룹 대화방 개설은 길드장(최초 구매자)만 가능합니다.");
  }

  if (!title) {
    alert("방 제목을 입력해 주세요.");
    document.getElementById("newRoomTitleInput").focus();
    return;
  }

  const checkedBoxes = document.querySelectorAll("input[name='createRoomMember']:checked");
  const selectedMembers = Array.from(checkedBoxes).map(cb => cb.value);

  if (type === "direct" && selectedMembers.length !== 1) {
    alert("1:1 대화방은 상대방 1명만 선택해 주세요.");
    return;
  }
  if (type === "private" && selectedMembers.length === 0) {
    alert("비밀 운영진방에 초대할 멤버를 1명 이상 선택해 주세요.");
    return;
  }

  try {
    const currentGid = localStorage.getItem("current_guild_id");
    const roomPayload = {
      room_name: title,
      room_type: type,
      created_by: myNick
    };
    if (currentGid) roomPayload.guild_id = currentGid;

    const res = await apiRequest("chat_rooms", "POST", [roomPayload]);

    if (!res || !res[0]) throw new Error("방 생성 응답 없음");
    const newRoom = res[0];

    const membersToInsert = [myNick, ...selectedMembers];
    const memberPayloads = membersToInsert.map(nick => ({
      room_id: newRoom.id,
      member_nickname: nick,
      role: (nick === myNick) ? "admin" : "member"
    }));

    await apiRequest("room_members", "POST", memberPayloads);

    if (typeof showKakaoToast === "function") {
      showKakaoToast(`[${title}] 대화방이 성공적으로 개설되었습니다!`, "🎉");
    }

    closeCreateRoomModal();
    loadMainTabRoomsList();
    openChatRoom(newRoom.id, title, type);
  } catch (err) {
    console.error("Room creation error:", err);
    alert("방 개설 중 오류가 발생했습니다: " + err.message);
  }
};

// --------------------------------------------------------
// 7. 실시간 대화방 생성 동기화 (Supabase Realtime)
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
  } catch (e) {
    console.warn("Rooms realtime subscription failed:", e);
  }
};

// --------------------------------------------------------
// 8. 라이선스 키로 길드 최초 개설 (길드장 활성화)
// --------------------------------------------------------
window.openActivateGuildModal = function() {
  const modal = document.getElementById("modalActivateGuild");
  if (modal) modal.style.display = "flex";
};
window.closeActivateGuildModal = function() {
  const modal = document.getElementById("modalActivateGuild");
  if (modal) modal.style.display = "none";
};
window.executeActivateGuild = async function() {
  const keyInput = (document.getElementById("actLicenseKeyInput").value || "").trim().toUpperCase();
  const nickInput = (document.getElementById("actMasterNickInput") ? document.getElementById("actMasterNickInput").value : "").trim();
  const pinInput = (document.getElementById("actMasterPinInput").value || "").trim();
  if (!keyInput) return alert("라이선스 키를 입력해 주세요.");
  if (!pinInput) return alert("길드장 비밀번호(PIN)를 입력해 주세요.");

  try {
    const licRes = await apiRequest(`app_licenses?license_key=eq.${encodeURIComponent(keyInput)}&select=*`);
    if (!licRes || licRes.length === 0) {
      return alert("유효하지 않은 라이선스 키입니다. 관리자에게 문의하세요.");
    }
    const lic = licRes[0];
    if (lic.status !== "active") {
      return alert("해당 라이선스는 현재 만료되었거나 정지 상태입니다.");
    }

    const masterNick = nickInput || lic.applicant_nickname || "길드장";
    const guildId = lic.guild_id;

    try {
      await apiRequest("guild_members", "POST", [{
        guild_id: guildId,
        nickname: masterNick,
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
      } catch(mErr2) {
        await apiRequest("guild_members", "POST", [{
          nickname: masterNick,
          role: "길드장",
          pin: pinInput
        }]);
      }
    }

    const roomCheck = await apiRequest(`chat_rooms?guild_id=eq.${guildId}&room_type=eq.public`);
    if (!roomCheck || roomCheck.length === 0) {
      await apiRequest("chat_rooms", "POST", [{
        guild_id: guildId,
        room_name: `${lic.guild_name} 전체 대화방`,
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
      invite_code: keyInput
    });
    localStorage.setItem("my_joined_guilds", JSON.stringify(joinedGuilds));

    alert(`[${lic.guild_name}] 길드가 성공적으로 개설되었습니다!\n${masterNick}님으로 로그인되었습니다.`);
    closeActivateGuildModal();
    location.reload();
  } catch (err) {
    console.error("Activate guild error:", err);
    alert("길드 개설 실패: " + err.message);
  }
};

// 페이지 로드 시 초기화
window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    initRoomsRealtime();
    switchMainBottomTab("chats");
  }, 100);
});
