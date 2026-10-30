// ========================================================
// [길드톡 메신저] 보스타임 & 토벌 알리미 전용 모듈 (boss.js)
// 보스 젠 타이머, 브리핑 카드, 실시간 알림, 레이드 참여 카운트다운
// ========================================================

window.cachedBossList = [];
window.bossWatcherInterval = null;
window.notifiedBossSpawnMap = new Set(JSON.parse(localStorage.getItem("boss_spawn_notified_keys") || "[]"));

function saveNotifiedBossKey(key) {
  if (!key) return;
  window.notifiedBossSpawnMap.add(key);
  const arr = Array.from(window.notifiedBossSpawnMap);
  if (arr.length > 200) arr.splice(0, arr.length - 200);
  localStorage.setItem("boss_spawn_notified_keys", JSON.stringify(arr));
}

// --------------------------------------------------------
// 1. 보스타임 목록 조회 및 동기화 (현재 guild_id 격리)
// --------------------------------------------------------
window.loadBossTimersList = async function() {
  try {
    if (typeof apiRequest !== "function") return;
    const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
    const bosses = await apiRequest(`boss_timers?guild_id=eq.${encodeURIComponent(currentGid)}&select=*&order=id.asc`);
    window.cachedBossList = Array.isArray(bosses) ? bosses : [];
    syncAllChatCutButtons();
  } catch (e) {
    console.warn("loadBossTimersList failed:", e);
  }
};

window.syncAllChatCutButtons = function() {
  const cutButtons = document.querySelectorAll(".btn-chat-cut");
  const now = Date.now();

  cutButtons.forEach(btn => {
    const bossName = btn.getAttribute("data-boss");
    if (!bossName) return;

    const b = window.cachedBossList.find(x => {
      const xName = x.boss_name || x.name || "";
      return xName.toLowerCase() === bossName.toLowerCase();
    });
    if (!b) return;

    if (b.next_spawn_time) {
      const diffSec = Math.floor((new Date(b.next_spawn_time).getTime() - now) / 1000);
      if (diffSec > 0) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-check"></i> 완료`;
        btn.classList.add("disabled");
      } else {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-crosshairs"></i> 즉시컷`;
        btn.classList.remove("disabled");
      }
    } else {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-crosshairs"></i> 즉시컷`;
      btn.classList.remove("disabled");
    }
  });
};

function extractBossNameFromMessage(text) {
  if (!text) return "";
  const match = text.match(/\[(.*?)\]/);
  return match ? match[1].trim() : "";
}
window.extractBossNameFromMessage = extractBossNameFromMessage;

// --------------------------------------------------------
// 2. 보스타임 채팅 브리핑 (카카오톡 카드 - guild_id & room_id 필수 포함)
// --------------------------------------------------------
window.postBossBriefingToChat = async function() {
  if (!window.cachedBossList || window.cachedBossList.length === 0) {
    await window.loadBossTimersList();
  }
  if (!window.cachedBossList || window.cachedBossList.length === 0) {
    if (typeof showKakaoToast === "function") showKakaoToast("등록된 보스 타이머가 없습니다.", "⚠️");
    return;
  }

  const now = Date.now();
  const sorted = [...window.cachedBossList].sort((a, b) => {
    const tA = a.next_spawn_time ? new Date(a.next_spawn_time).getTime() : 9999999999999;
    const tB = b.next_spawn_time ? new Date(b.next_spawn_time).getTime() : 9999999999999;
    return tA - tB;
  });

  const currentKstFormatted = (typeof formatTime24Hour === "function") ? formatTime24Hour(new Date()) : "";
  let briefingHtml = `<div class="boss-brief-title" style="font-size:12.5px; font-weight:800; color:#0284c7; margin-bottom:5px; display:flex; align-items:center;">
    <i class="fa-solid fa-clock-rotate-left me-1"></i>[보스타임 현황 브리핑] <span style="font-size:11px; color:var(--kakao-time-gray); font-weight:600; margin-left:4px;">(${currentKstFormatted} 기준)</span>
  </div>`;
  briefingHtml += `<div style="display:grid; grid-template-columns: 78px 52px 1fr; align-items:center; font-size:10.5px; font-weight:700; color:var(--kakao-time-gray); padding:3px 0 4px 0; border-bottom:1px dashed var(--drawer-card-border); margin-bottom:4px;">
    <span style="text-align:left;">보스명</span>
    <span style="text-align:center;">젠 예정</span>
    <span style="text-align:right;">상태 (남은시간)</span>
  </div>`;

  sorted.forEach((b) => {
    let stateBadge = `<span style="background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0; font-size:10px; font-weight:700; padding:2px 6px; border-radius:5px; white-space:nowrap; display:inline-block;">컷 대기</span>`;
    let timeDisplay = "-";
    const bName = b.boss_name || b.name || "보스";

    if (b.next_spawn_time) {
      const nextDate = new Date(b.next_spawn_time);
      const diffSec = Math.floor((nextDate.getTime() - now) / 1000);
      timeDisplay = (typeof formatTime24Hour === "function") ? formatTime24Hour(nextDate) : "";

      if (diffSec <= 0) {
        const passM = Math.floor(Math.abs(diffSec) / 60);
        stateBadge = `<span style="background:#fee2e2; color:#dc2626; border:1px solid #fca5a5; font-size:10px; font-weight:800; padding:2px 6px; border-radius:5px; white-space:nowrap; display:inline-block;">🎉 젠 완료 (+${passM}분)</span>`;
      } else if (diffSec <= 3600) {
        const m = Math.floor(diffSec / 60);
        const s = diffSec % 60;
        stateBadge = `<span style="background:#fef3c7; color:#d97706; border:1px solid #fde68a; font-size:10px; font-weight:800; padding:2px 6px; border-radius:5px; white-space:nowrap; display:inline-block;">⏳ ${m}분 ${s}초 전</span>`;
      } else {
        const h = Math.floor(diffSec / 3600);
        const m = Math.floor((diffSec % 3600) / 60);
        stateBadge = `<span style="background:#e0f2fe; color:#0284c7; border:1px solid #bae6fd; font-size:10px; font-weight:700; padding:2px 6px; border-radius:5px; white-space:nowrap; display:inline-block;">${h}시간 ${m}분 남음</span>`;
      }
    }

    briefingHtml += `<div class="boss-brief-row" style="display:grid; grid-template-columns: 78px 52px 1fr; align-items:center; padding:3px 0; font-size:11px; border-bottom:1px solid rgba(0,0,0,0.03);">
      <span class="boss-name" style="font-weight:700; color:var(--drawer-title); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left;">${bName}</span>
      <span class="spawn-time" style="color:var(--kakao-time-gray); font-size:10.5px; text-align:center;">${timeDisplay}</span>
      <div style="display:flex; justify-content:flex-end;">${stateBadge}</div>
    </div>`;
  });

  try {
    const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
    const targetRoomId = window.currentActiveRoomId || "default_public";
    await apiRequest("guild_chats", "POST", [{
      guild_id: currentGid,
      room_id: targetRoomId,
      sender_name: "보스알리미",
      message: briefingHtml,
      msg_type: "boss_briefing",
      mentions: []
    }]);
    if (typeof showKakaoToast === "function") showKakaoToast("보스타임이 브리핑되었습니다!", "⏰");
  } catch (err) {
    if (typeof showKakaoToast === "function") showKakaoToast("브리핑 전송 실패: " + err.message, "❌");
  }
};

// --------------------------------------------------------
// 3. 채팅 말풍선 [즉시컷] 원클릭 실행 (guild_id 격리 적용)
// --------------------------------------------------------
window.triggerQuickCutAction = async function(bossName, btnId) {
  const btn = document.getElementById(btnId);
  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
  const boss = (window.cachedBossList || []).find(b => {
    const xName = b.boss_name || b.name || "";
    return xName.toLowerCase() === bossName.toLowerCase();
  });

  if (!boss) {
    if (typeof showKakaoToast === "function") showKakaoToast("보스 정보를 찾을 수 없습니다.", "❌");
    return;
  }

  if (boss.next_spawn_time) {
    const diffSec = Math.floor((new Date(boss.next_spawn_time).getTime() - Date.now()) / 1000);
    if (diffSec > 0) {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-check"></i> 완료`;
        btn.classList.add("disabled");
      }
      if (typeof showKakaoToast === "function") showKakaoToast(`[${bossName}] 이미 컷 완료된 보스입니다!`, "⚠️");
      return;
    }
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> 완료`;
    btn.classList.add("disabled");
  }

  const cutDate = new Date();
  const cycleMin = boss.cycle_min || 720;
  const nextSpawn = new Date(cutDate.getTime() + (cycleMin * 60 * 1000));
  const myNick = localStorage.getItem("guild_my_nickname") || "길드원";

  try {
    await apiRequest(`boss_timers?guild_id=eq.${encodeURIComponent(currentGid)}&id=eq.${boss.id}`, "PATCH", {
      last_cut_time: cutDate.toISOString(),
      next_spawn_time: nextSpawn.toISOString()
    });

    const targetRoomId = window.currentActiveRoomId || "default_public";
    const timeFormatted = (typeof formatTime24Hour === "function") ? formatTime24Hour(nextSpawn) : "";

    await apiRequest("guild_chats", "POST", [{
      guild_id: currentGid,
      room_id: targetRoomId,
      sender_name: "보스알리미",
      message: `⚔️ [${bossName}] ${myNick}님에 의해 즉시 컷 처리되었습니다! (다음 젠: ${timeFormatted})`,
      msg_type: "boss_alert",
      mentions: []
    }]);

    if (typeof showKakaoToast === "function") showKakaoToast(`[${bossName}] 컷 완료!`, "🎉");
    await window.loadBossTimersList();
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-crosshairs"></i> 즉시컷`;
      btn.classList.remove("disabled");
    }
    if (typeof showKakaoToast === "function") {
      showKakaoToast("컷 실패: " + err.message, "❌");
    }
  }
};

// --------------------------------------------------------
// 4. 레이드 토벌 참여자 알리미 3분 카운트다운 타이머
// --------------------------------------------------------
window.startRaidReportCountdowns = function() {
  const cdSpans = document.querySelectorAll(".raid-countdown-timer[data-created-at]");
  const now = Date.now();

  cdSpans.forEach(span => {
    const createdAtStr = span.getAttribute("data-created-at");
    if (!createdAtStr) return;

    let createdTime = new Date(createdAtStr).getTime();
    if (isNaN(createdTime)) return;

    const limitTime = createdTime + (3 * 60 * 1000);
    const remainMs = limitTime - now;

    const raidId = span.getAttribute("data-raid-id");
    const joinBtn = document.getElementById(`btn_raid_join_${raidId}`);

    if (remainMs <= 0) {
      span.innerHTML = `<i class="fa-solid fa-hourglass-end me-1"></i>참여 마감`;
      span.style.color = "#94a3b8";
      if (joinBtn) {
        joinBtn.disabled = true;
        joinBtn.classList.add("disabled");
        joinBtn.style.opacity = "0.5";
        joinBtn.innerHTML = `<i class="fa-solid fa-lock me-1"></i>참여 마감`;
      }
    } else {
      const remainSec = Math.floor(remainMs / 1000);
      const m = Math.floor(remainSec / 60);
      const s = remainSec % 60;
      span.innerHTML = `<i class="fa-regular fa-clock me-1"></i>${m}:${s < 10 ? '0' : ''}${s}`;
      span.style.color = "#ef4444";
    }
  });
};

window.handleQuickRaidSelfAdd = async function(raidId, bossName) {
  const myNick = localStorage.getItem("guild_my_nickname") || "";
  if (!myNick) {
    if (typeof showKakaoToast === "function") showKakaoToast("로그인이 필요합니다.", "⚠️");
    return;
  }

  const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
  const btn = document.getElementById(`btn_raid_join_${raidId}`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-1"></i>참여 중...`;
  }

  try {
    const records = await apiRequest(`boss_participations?guild_id=eq.${encodeURIComponent(currentGid)}&id=eq.${raidId}&select=*`);
    if (!records || records.length === 0) throw new Error("레이드 기록을 찾을 수 없습니다.");

    const raid = records[0];
    let memberList = [];
    if (Array.isArray(raid.members)) memberList = [...raid.members];
    else if (typeof raid.members === "string") {
      try { memberList = JSON.parse(raid.members); } catch (e) { memberList = [raid.members]; }
    }

    if (memberList.includes(myNick)) {
      if (typeof showKakaoToast === "function") showKakaoToast("이미 참여 명단에 등록되어 있습니다!", "⚠️");
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-check me-1"></i>참여 완료`;
      }
      return;
    }

    memberList.push(myNick);

    await apiRequest(`boss_participations?guild_id=eq.${encodeURIComponent(currentGid)}&id=eq.${raidId}`, "PATCH", {
      members: memberList,
      member_count: memberList.length
    });

    const targetRoomId = window.currentActiveRoomId || "default_public";
    await apiRequest("guild_chats", "POST", [{
      guild_id: currentGid,
      room_id: targetRoomId,
      sender_name: "보스알리미",
      message: `🙋‍♂️ [${bossName}] 토벌에 ${myNick}님이 추가 참여하셨습니다! (현재 참여: ${memberList.length}명)`,
      msg_type: "chat",
      mentions: []
    }]);

    if (typeof showKakaoToast === "function") showKakaoToast(`[${bossName}] 토벌 참여 완료!`, "🎉");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-check me-1"></i>참여 완료`;
    }
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-user-plus me-1"></i>나도 참여`;
    }
    if (typeof showKakaoToast === "function") {
      showKakaoToast("참여 등록 실패: " + err.message, "❌");
    }
  }
};

// --------------------------------------------------------
// 5. 보스타임 MP3 알림음 재생 & 로컬 실시간 감시 엔진
// --------------------------------------------------------
window.triggerBossAlarmSound = function(isImportant = false) {
  const isEnabled = localStorage.getItem("guild_alarm_enabled") !== "false";
  if (!isEnabled) return;

  const soundFile = localStorage.getItem("guild_alarm_sound") || (isImportant ? "alarm2.mp3" : "alarm1.mp3");
  const audioPath = soundFile.startsWith("http") ? soundFile : `/assets/sounds/${soundFile}`;

  try {
    const audio = new Audio(audioPath);
    audio.volume = isImportant ? 0.95 : 0.85;
    audio.play().catch(() => {
      window.triggerBeepSound(isImportant);
    });
  } catch (e) {
    window.triggerBeepSound(isImportant);
  }
};

window.triggerBeepSound = function(isImportant = false) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = isImportant ? "sawtooth" : "sine";
    osc.frequency.setValueAtTime(isImportant ? 880 : 440, ctx.currentTime);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {}
};

window.startLocalBossWatchTimer = function() {
  if (window.bossWatcherInterval) clearInterval(window.bossWatcherInterval);

  window.bossWatcherInterval = setInterval(async () => {
    window.startRaidReportCountdowns();

    const now = Date.now();
    if (!window.cachedBossList || window.cachedBossList.length === 0) return;

    const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");

    for (const b of window.cachedBossList) {
      if (b.guild_id && b.guild_id !== currentGid) continue;
      if (!b.next_spawn_time) continue;

      const spawnTime = new Date(b.next_spawn_time).getTime();
      const diffSec = Math.floor((spawnTime - now) / 1000);
      const bossName = b.boss_name || b.name || "보스";

      // 5분 전 알림 (MP3 알림음 연동)
      if (diffSec <= 300 && diffSec > 60) {
        const key5m = `${currentGid}_${b.id}_5m_${b.next_spawn_time}`;
        if (!window.notifiedBossSpawnMap.has(key5m)) {
          saveNotifiedBossKey(key5m);
          window.triggerBossAlarmSound(false);
          if (typeof showKakaoToast === "function") {
            showKakaoToast(`⏰ [${bossName}] 젠 5분 전입니다!`, "⚠️");
          }
        }
      }

      // 젠 완료 알림 (중요 MP3 알림음 연동)
      if (diffSec <= 0 && diffSec > -180) {
        const keySpawn = `${currentGid}_${b.id}_spawn_${b.next_spawn_time}`;
        if (!window.notifiedBossSpawnMap.has(keySpawn)) {
          saveNotifiedBossKey(keySpawn);
          window.triggerBossAlarmSound(true);
          if (typeof showKakaoToast === "function") {
            showKakaoToast(`🚨 [${bossName}] 지금 젠되었습니다!`, "🔥");
          }
        }
      }
    }
  }, 1000);
};

// --------------------------------------------------------
// 6. 보스타임 실시간 구독 (Supabase Realtime - 타 길드 이벤트 무시)
// --------------------------------------------------------
window.listenRealtimeBossTimers = function() {
  if (!window.supabaseClient) return;

  try {
    window.supabaseClient
      .channel("public:boss_timers")
      .on("postgres_changes", { event: "*", schema: "public", table: "boss_timers" }, (payload) => {
        const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
        if (payload.new && payload.new.guild_id && payload.new.guild_id !== currentGid) return;
        window.loadBossTimersList();
      })
      .subscribe();

    window.supabaseClient
      .channel("public:boss_participations")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "boss_participations" }, (payload) => {
        if (!payload.new) return;
        const currentGid = (typeof getCurrentGuildId === "function") ? getCurrentGuildId() : (localStorage.getItem("current_guild_id") || "default");
        if (payload.new.guild_id && payload.new.guild_id !== currentGid) return;

        const raidId = payload.new.id;
        const memberCount = payload.new.member_count || (payload.new.members ? payload.new.members.length : 0);
        const countBadge = document.getElementById(`raid_members_count_${raidId}`);
        if (countBadge) countBadge.innerText = `${memberCount}명`;
      })
      .subscribe();
  } catch (e) {
    console.warn("Boss realtime subscription error:", e);
  }
};
