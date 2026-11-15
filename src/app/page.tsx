import Link from 'next/link';

/** Trang chủ tạm thời của backend. Frontend đầy đủ sẽ được chuyển sang ở phase giao diện. */
export default function Home() {
  return (
    <main className="wrap">
      <div className="card">
        <h1>luyenthuyettrinh.com</h1>
        <p className="muted">Backend Phase 1: tài khoản, hồ sơ, mục tiêu mặc định.</p>
        <div className="links"><Link className="btn" href="/register">Đăng ký</Link><Link className="btn ghost" href="/login">Đăng nhập</Link></div>
      </div>
    </main>
  );
}
