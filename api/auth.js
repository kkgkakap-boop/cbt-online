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
      const { data: admin } = await supabase.from('admin_users').select('*').eq('username', username).single();
      if (!admin || !bcrypt.compareSync(password, admin.password)) {
        return res.status(200).json({ status: 'ERROR', data: 'Username atau Password Admin Salah!' });
      }

      return res.status(200).json({
        status: 'SUCCESS',
        data: {
          username: admin.username,
          namaAdmin: admin.nama_admin,
          role: admin.role, // 'PUSAT' atau 'SEKOLAH'
          sekolah: admin.sekolah,
          permissions: {
            canUploadSoal: admin.can_upload_soal,
            canManageSiswa: admin.can_manage_siswa,
            canResetSiswa: admin.can_reset_siswa,
            canExportNilai: admin.can_export_nilai
          }
        }
      });
    }
  } catch (err) {
    return res.status(500).json({ status: 'ERROR', data: 'Internal Server Error' });
  }
}