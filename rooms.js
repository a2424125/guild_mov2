// ========================================================
// [길드톡 메신저] 카카오톡 스타일 메인 3탭 & 다중 톡방 관리 모듈 (rooms.js)
// 친구 목록 / 대화방 목록 / 개인설정 탭 제어 및 방 개설(운영진방, 1:1 개인톡)
// ========================================================

window.currentActiveRoomId = null;
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
      const isMe = (mName === myNick);
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

      // 안전한 파라미터 이스케이프
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

// 길드원 항목 클릭 핸들러
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
              <span class="room-time-text">입장 <i class="fa-solid fa-chevron-right ms-1"></i></span>
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
    const currentGid = localStorage.getItem("current_guild_id");
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
    const roomPayload = {
      room_name: roomTitle,
      room_type: "direct",
      created_by: myNick
    };
    if (currentGid) roomPayload.guild_id = currentGid;

    let newRoomId = "direct_" + Date.now();
    try {
      if (typeof apiRequest === "function") {
        const createRes = await apiRequest("chat_rooms", "POST", [roomPayload]);
        if (createRes && createRes[0] && createRes[0].id) {
          newRoomId = createRes[0].id;
          await apiRequest("room_members", "POST", [
            { room_id: newRoomId, member_nickname: myNick, role: "member" },
            { room_id: newRoomId, member_nickname: targetNick, role: "member" }
          ]);
        }
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
// 7. 모달 제어 전역 함수 보장 (프로필 변경 & 1:1 대화 팝업)
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
      await apiRequest(`guild_members?name=eq.${encodeURIComponent(myCurrentNick)}`, "PATCH", {
        job_class: myCurrentClass
      });
    } catch (e) {
      try {
        await apiRequest(`guild_members?nickname=eq.${encodeURIComponent(myCurrentNick)}`, "PATCH", {
          job_class: myCurrentClass
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
// 8. 새 대화방 개설 모달 제어
// --------------------------------------------------------
window.openCreateRoomModal = function() {
  const modal = document.getElementById("modalCreateRoom");
  const myNick = (localStorage.getItem("guild_my_nickname") || localStorage.getItem("guild_my_nick") || "");
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

    let newRoom = { id: "room_" + Date.now(), room_name: title, room_type: roomPayload.room_type };
    if (typeof apiRequest === "function") {
      const res = await apiRequest("chat_rooms", "POST", [roomPayload]);
      if (res && res[0]) newRoom = res[0];
    }

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
