import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ status: 'ERROR', data: 'Method not allowed' });
  const { action, username, password } = req.body;

  try {
    if (action === 'login_siswa') {
      const { data: siswa } = await supabase.from('siswa').select('*').eq('username', username).single();
      if (!siswa || !bcrypt.compareSync(password, siswa.password)) {
        return res.status(200).json({ status: 'ERROR', data: 'Username atau Password Salah!' });
      }

      // Cek sesi aktif & timeout otomatis 30 menit
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      await supabase.from('active_sessions')
        .update({ status: 'TIMEOUT' })
        .eq('student_id', siswa.student_id)
        .eq('status', 'ON_PROGRESS')
        .lt('last_ping', thirtyMinutesAgo);

      const { data: activeSess } = await supabase.from('active_sessions')
        .select('*')
        .eq('student_id', siswa.student_id)
        .eq('status', 'ON_PROGRESS')
        .maybeSingle();

      if (activeSess) {
        return res.status(200).json({ status: 'ERROR', data: 'Login Ditolak! Sesi ujian lain masih aktif.' });
      }

      return res.status(200).json({
        status: 'SUCCESS',
        data: { studentId: siswa.student_id, nama: siswa.nama, kelas: siswa.kelas, sekolah: siswa.sekolah }
      });
    }

    if (action === 'login_admin') {
      if (username === (process.env.ADMIN_USER || 'admin') && password === (process.env.ADMIN_PASS || 'admin123')) {
        return res.status(200).json({ status: 'SUCCESS', token: 'ADMIN-AUTH-TOKEN' });
      }
      return res.status(200).json({ status: 'ERROR', data: 'Admin Unauthorized' });
    }
  } catch (err) {
    return res.status(500).json({ status: 'ERROR', data: 'Internal Server Error' });
  }
}