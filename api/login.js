import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ status: 'ERROR', data: 'Method not allowed' });

  const { username, password } = req.body;

  try {
    // Cek data siswa
    let { data: siswa, error } = await supabase
      .from('siswa')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .single();

    if (error || !siswa) {
      return res.status(200).json({ status: 'ERROR', data: 'Username atau Password Salah!' });
    }

    // Cek apakah ada sesi aktif yang belum selesai
    let { data: activeSess } = await supabase
      .from('active_sessions')
      .select('*')
      .eq('student_id', siswa.student_id)
      .eq('status', 'ON_PROGRESS')
      .single();

    if (activeSess) {
      return res.status(200).json({ 
        status: 'ERROR', 
        data: 'Login Ditolak! Anda masih memiliki sesi ujian yang AKTIF.' 
      });
    }

    return res.status(200).json({ 
      status: 'SUCCESS', 
      data: {
        studentId: siswa.student_id,
        nama: siswa.nama,
        kelas: siswa.kelas,
        sekolah: siswa.sekolah
      } 
    });

  } catch (err) {
    return res.status(500).json({ status: 'ERROR', data: err.message });
  }
}