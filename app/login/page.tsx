'use client';
import { useState } from 'react';

// 登入頁。走到這裡代表來源 IP 已經過了白名單那一關，這裡再確認「你是誰」。
export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!username.trim() || !password) { setError('請輸入帳號與密碼'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `登入失敗 (${res.status})`);
      // 用整頁導向而不是 router.push —— session 是 cookie，重新載入才會帶著它過 proxy
      const next = new URLSearchParams(window.location.search).get('next') || '/';
      window.location.href = next.startsWith('/') ? next : '/';
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="bg-white rounded-lg shadow-lg p-8 w-96">
        <h1 className="text-2xl font-bold mb-1 text-center text-gray-900">審計系統登入</h1>
        <p className="text-xs text-gray-500 mb-6 text-center">來源 IP 已通過白名單，請輸入帳號密碼</p>

        <label className="block text-sm font-medium mb-1 text-gray-700">帳號</label>
        <input className="w-full border p-2 rounded mb-3 text-black" value={username}
          onChange={e => setUsername(e.target.value)} autoComplete="username"
          onKeyDown={e => e.key === 'Enter' && submit()} />

        <label className="block text-sm font-medium mb-1 text-gray-700">密碼</label>
        <input className="w-full border p-2 rounded mb-4 text-black" type="password" value={password}
          onChange={e => setPassword(e.target.value)} autoComplete="current-password"
          onKeyDown={e => e.key === 'Enter' && submit()} />

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <button onClick={submit} disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
          {loading ? '登入中…' : '登入'}
        </button>
      </div>
    </div>
  );
}
