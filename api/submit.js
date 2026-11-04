import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ status: 'ERROR', data: 'Method not allowed' });
  const sessionToken = req.headers['x-session-token'];
  if (!sessionToken) return res.status(403).json({ status: 'ERROR', data: 'Unauthorized' });

  const { jawaban } = req.body;

  try {
    const { data: activeSess } = await supabase.from('active_sessions').select('*').eq('session_token', sessionToken).eq('status', 'ON_PROGRESS').single();
    if (!activeSess) return res.status(200).json({ status: 'ERROR', data: 'Sesi sudah selesai atau tidak ditemukan.' });

    const studentId = activeSess.student_id;
    const { data: siswa } = await supabase.from('siswa').select('sekolah, nama').eq('student_id', studentId).single();

    const { data: listSoal } = await supabase.from('soal').select('*').eq('kelas', activeSess.kelas).eq('mapel', activeSess.mapel).eq('status', 'AKTIF');

    let pgScore = 0;
    let pgDetail = {};
    let urDetail = {};

    for (let s of (listSoal || [])) {
      let idS = String(s.id).trim();
      let uAns = (jawaban[idS] || "").toString().trim();
      let jns = String(s.jenis).toUpperCase();
      let bbt = parseFloat(s.skor || 0);

      if (jns === 'PG') {
        pgDetail[idS] = uAns;
        if (uAns.toUpperCase() === String(s.kunci).trim().toUpperCase()) pgScore += bbt;
      } else if (jns === 'U') {
        urDetail[idS] = uAns;
      }
    }

    let total = Math.round(pgScore);

    const { error: insertErr } = await supabase.from('hasil_ujian').insert([{
      student_id: studentId,
      sekolah: siswa?.sekolah || '-',
      nama: siswa?.nama || '-',
      kelas: activeSess.kelas,
      mapel: activeSess.mapel,
      jawaban: JSON.stringify(pgDetail),
      uraian_detail: JSON.stringify(urDetail),
      pg_score: pgScore,
      uraian_score: 0,
      total_score: total
    }]);

    if (insertErr) {
      return res.status(200).json({ status: 'SUCCESS', data: { nilaiTotal: total } });
    }

    await supabase.from('active_sessions').update({ status: 'SELESAI' }).eq('session_token', sessionToken);

    return res.status(200).json({ status: 'SUCCESS', data: { nilaiPG: pgScore, nilaiTotal: total } });
  } catch (err) {
    return res.status(500).json({ status: 'ERROR', data: 'Gagal memproses pengiriman ujian.' });
  }
}