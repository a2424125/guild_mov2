// --------------------------------------------------------
// 5. 과거 대화 로드 & 실시간 대화 수신 (방별 격리 & 노란색 읽음 계산)
// --------------------------------------------------------
async function loadPastChatMessages() {
  const isInChatView = (document.getElementById("chatRoomView") && document.getElementById("chatRoomView").style.display === "flex");
  const activeRoom = window.currentActiveRoomId;
  const chatContainer = document.getElementById("chatMessagesView");
  if (!chatContainer) return;

  // ⚡ 실제 대화방 화면에 진입하지 않았거나 activeRoom이 없으면 목록 화면에서 임의 실행 차단!
  if (!isInChatView || !activeRoom) return;

  // 1) 로컬 캐시에서 먼저 즉시 복원하여 화면 깜빡임 및 빈 화면 방지
  const cacheKey = "chat_history_cache_" + activeRoom;
  let cachedMessages = [];
  try {
    cachedMessages = JSON.parse(sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey) || "[]");
  } catch(e) {}

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
    let endpoint = "guild_chats?select=*&order=id.desc&limit=150";
    if (activeRoom !== "default_public") {
      endpoint = currentGid 
        ? `guild_chats?guild_id=eq.${encodeURIComponent(currentGid)}&room_id=eq.${encodeURIComponent(activeRoom)}&select=*&order=id.desc&limit=150`
        : `guild_chats?room_id=eq.${encodeURIComponent(activeRoom)}&select=*&order=id.desc&limit=150`;
    } else if (currentGid) {
      endpoint = `guild_chats?guild_id=eq.${encodeURIComponent(currentGid)}&select=*&order=id.desc&limit=150`;
    }

    let list = [];
    try {
      list = await apiRequest(endpoint);
    } catch (reqErr) {
      try {
        list = await apiRequest("guild_chats?select=*&order=id.desc&limit=150");
      } catch (err2) {}
    }

    if (list && list.length > 0) {
      // 3) [방 격리 보장]: 1:1 대화 내용이 단체 대화방에 절대 노출되지 않도록 필터링
      let filtered = list.filter(c => {
        if (activeRoom === "default_public") {
          return !c.room_id || c.room_id === "default_public" || c.room_id === "public";
        } else {
          return c.room_id === activeRoom;
        }
      });

      const mergedMap = new Map();
      cachedMessages.forEach(m => { if (m.id) mergedMap.set(String(m.id), m); });
      filtered.forEach(m => { if (m.id) mergedMap.set(String(m.id), m); });

      const finalSorted = Array.from(mergedMap.values()).sort((a, b) => {
        const tA = new Date(a.created_at || 0).getTime() || 0;
        const tB = new Date(b.created_at || 0).getTime() || 0;
        return tA - tB;
      });

      try {
        localStorage.setItem(cacheKey, JSON.stringify(finalSorted.slice(-100)));
        sessionStorage.setItem(cacheKey, JSON.stringify(finalSorted.slice(-100)));
      } catch(e) {}

      // ⚡ [오직 현재 열려 있는 이 방만 읽음 처리]: 다른 방의 읽음 상태에는 일절 손대지 않음!
      const maxId = Math.max(...finalSorted.map(m => m.id || 0));
      if (maxId > 0 && activeRoom) {
        localStorage.setItem("last_read_chat_id_" + activeRoom, String(maxId));
        const badgeElem = document.getElementById("room_badge_" + activeRoom);
        if (badgeElem) {
          badgeElem.innerText = "";
          badgeElem.setAttribute("data-count", "0");
          badgeElem.classList.add("d-none");
          badgeElem.style.display = "none";
        }
      }

      renderMessageHistoryList(finalSorted);
    }
  } catch (e) {
    console.warn("loadPastChatMessages error:", e);
  }
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

      // 1) 해당 방의 로컬 캐시 실시간 업데이트
      try {
        const cacheKey = "chat_history_cache_" + msgRoom;
        let localMsgs = JSON.parse(sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey) || "[]");
        if (!localMsgs.find(m => String(m.id) === String(newMsg.id))) {
          localMsgs.push(newMsg);
          sessionStorage.setItem(cacheKey, JSON.stringify(localMsgs.slice(-100)));
          localStorage.setItem(cacheKey, JSON.stringify(localMsgs.slice(-100)));
        }
      } catch(e) {}

      // 2) [방별 격리]: 실제 대화방 화면 안에 있고 현재 보고 있는 방과 일치할 때만 화면에 렌더링
      const isInChatView = (document.getElementById("chatRoomView") && document.getElementById("chatRoomView").style.display === "flex");
      if (!isInChatView || !activeRoom) return;

      if (activeRoom === "default_public") {
        if (newMsg.room_id && newMsg.room_id !== "default_public" && newMsg.room_id !== "public") {
          return;
        }
      } else {
        if (newMsg.room_id !== activeRoom) {
          return;
        }
      }

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
    .subscribe();
}
