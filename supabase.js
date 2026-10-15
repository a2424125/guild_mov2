// ==========================================
// [ECLIPSE Guild Management System]
// Supabase REST API 통신 공통 모듈 (supabase.js)
// ==========================================

const SUPABASE_CONFIG = {
  url: "https://yakvjsnzqgycdbasbnfe.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlha3Zqc256cWd5Y2RiYXNibmZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNTg4NTQsImV4cCI6MjEwNzYzNDg1NH0.TBheUmh9Z4RPCI-UXyb3yDSfjlYNShpzX7tZLm-4Qgw"
};

/**
 * Supabase REST API 직접 호출 공통 함수
 * @param {string} endpoint - 테이블명 및 쿼리 파라미터 (예: 'guild_members?select=*')
 * @param {string} method - GET, POST, PATCH, DELETE
 * @param {object|array|null} body - 전송할 JSON 데이터
 * @param {object} extraHeaders - 추가 HTTP 헤더
 */
async function apiRequest(endpoint, method = "GET", body = null, extraHeaders = {}) {
  const url = `${SUPABASE_CONFIG.url}/rest/v1/${endpoint}`;
  const headers = {
    "apikey": SUPABASE_CONFIG.anonKey,
    "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
    ...extraHeaders
  };

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || `HTTP ${res.status}`);
  }
  
  // 204 No Content 등 본문이 없는 응답 방어
  if (res.status === 204) return null;
  return await res.json();
}

// ==========================================
// 🕒 [KST 표준 타임존 변환 유틸리티]
// 브라우저 타임존 오차 및 자정 전후(0~9시) 날짜 밀림 방지
// ==========================================

/**
 * 어떤 Date 객체나 날짜 문자열이 들어와도 정확한 한국 기준 'YYYY-MM-DD'로 반환
 * @param {Date|string|number} dateInput 
 * @returns {string} 예: "2026-10-11"
 */
function getKSTDateString(dateInput = new Date()) {
  const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return "";

  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value || '';
  const m = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  return `${y}-${m}-${day}`;
}

/**
 * input type="datetime-local" 입력창에 들어갈 'YYYY-MM-DDTHH:mm' 형식 반환
 * @param {Date|string|number} dateInput 
 * @returns {string} 예: "2026-10-11T14:30"
 */
function getKSTDateTimeLocalString(dateInput = new Date()) {
  const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return "";

  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value || '';
  const m = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  let hour = parts.find(p => p.type === 'hour')?.value || '00';
  const min = parts.find(p => p.type === 'minute')?.value || '00';

  // 24시 표기 방어
  if (hour === '24') hour = '00';

  return `${y}-${m}-${day}T${hour}:${min}`;
}
