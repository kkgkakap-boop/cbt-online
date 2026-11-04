import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  const { action } = req.query;

  try {
    // 1. Ambil Mapel Aktif (Belum dikerjakan)
    if (action === 'getActiveMapel') {
      const { studentId, kelas } = req.query;

      const { data: hasil } = await supabase.from('hasil_ujian').select('mapel').eq('student_id', studentId);
      const mapelSelesai = (hasil || []).map(h => (h.mapel || '').trim().toUpperCase());

      const { data: riwayat } = await supabase.from('riwayat_ujian').select('mapel').eq('kelas', kelas).eq('status', 'AKTIF');
      const mapelAktif = (riwayat || [])
        .map(r => r.mapel.trim())
        .filter(m => !mapelSelesai.includes(m.toUpperCase()));

      return res.status(200).json([...new Set(mapelAktif)]);
    }

    // 2. Validasi Token & Buat Sesi
    if (action === 'checkToken' && req.method === 'POST') {
      const { studentId, kelas, mapel, token, nama } = req.body;
      const cleanToken = (token || '').trim().toUpperCase();

      const { data: activeSess } = await supabase
        .from('active_sessions')
        .select('*')
        .eq('student_id', studentId)
        .eq('status', 'ON_PROGRESS')
        .maybeSingle();

      if (activeSess) {
        return res.status(200).json({ status: 'ERROR', data: 'Login Ditolak! Anda masih memiliki sesi aktif.' });
      }

      const { data: rw } = await supabase
        .from('riwayat_ujian')
        .select('*')
        .eq('token', cleanToken)
        .eq('kelas', kelas)
        .eq('mapel', mapel)
        .eq('status', 'AKTIF')
        .maybeSingle();

      if (!rw) return res.status(200).json({ status: 'ERROR', data: 'Token tidak valid / Mata Pelajaran tidak sesuai.' });

      const sessionId = 'SESS-' + Date.now();
      await supabase.from('active_sessions').insert([{
        session_id: sessionId,
        student_id: studentId,
        kelas, mapel, token: cleanToken,
        status: 'ON_PROGRESS',
        start_time: new Date().toISOString(),
        last_ping: new Date().toISOString()
      }]);

      return res.status(200).json({
        status: 'SUCCESS',
        data: { sessionId, studentId, nama, kelas, mapel, token: cleanToken, durasi: rw.durasi }
      });
    }

    // 3. Ambil Soal & Progress Siswa
    if (action === 'getSoal') {
      const { token, studentId } = req.query;

      const { data: sess } = await supabase
        .from('active_sessions')
        .select('*')
        .eq('student_id', studentId)
        .eq('token', token.toUpperCase())
        .eq('status', 'ON_PROGRESS')
        .order('start_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!sess) return res.status(200).json({ status: 'ERROR', data: 'Sesi tidak aktif.' });

      const { data: soalList } = await supabase
        .from('soal')
        .select('id_soal, kelas, mapel, soal, opsia, opsib, opsic, opsid, jenis, skor')
        .eq('kelas', sess.kelas)
        .eq('mapel', sess.mapel)
        .eq('status', 'AKTIF');

      const formatted = (soalList || []).map(s => ({
        id: s.id_soal,
        pertanyaan: s.soal,
        opsiA: s.opsia, opsiB: s.opsib, opsiC: s.opsic, opsiD: s.opsid,
        jenis: s.jenis, skor: s.skor
      }));

      return res.status(200).json({
        status: 'SUCCESS',
        data: { soal: formatted, progress: sess.progress }
      });
    }

    // 4. Update Ping & Simpan Progress Real-time
    if (action === 'ping' && req.method === 'POST') {
      const { sessionId, jawaban, ragu, lastIndex } = req.body;
      const payload = { last_ping: new Date().toISOString() };
      if (jawaban !== undefined) payload.progress = { jawaban, ragu, lastIndex };

      await supabase.from('active_sessions').update(payload).eq('session_id', sessionId);
      return res.status(200).json({ status: 'OK' });
    }

    // 5. Ambil Start Time untuk Timer Server-Side
    if (action === 'getStartTime') {
      const { sessionId } = req.query;
      const { data: sess } = await supabase.from('active_sessions').select('start_time').eq('session_id', sessionId).single();
      return res.status(200).json({ startTime: sess ? new Date(sess.start_time).getTime() : Date.now() });
    }

    // --- ADMIN PANEL ACTIONS ---
    if (action === 'getDashboardData') {
      const { count: totalSiswa } = await supabase.from('siswa').select('*', { count: 'exact', head: true });
      const { count: totalSoal } = await supabase.from('soal').select('*', { count: 'exact', head: true });
      const { count: ujianAktif } = await supabase.from('riwayat_ujian').select('*', { count: 'exact', head: true }).eq('status', 'AKTIF');
      const { count: siswaOnline } = await supabase.from('active_sessions').select('*', { count: 'exact', head: true }).eq('status', 'ON_PROGRESS');
      return res.status(200).json({ totalSiswa: totalSiswa || 0, totalSoal: totalSoal || 0, ujianAktif: ujianAktif || 0, siswaOnline: siswaOnline || 0 });
    }

    if (action === 'getAllSiswa') {
      const { data } = await supabase.from('siswa').select('*');
      return res.status(200).json((data || []).map(s => ({
        studentId: s.studentId, sekolah: s.sekolah, nama: s.nama, tglLahir: s.tanggalLahir,
        kelas: s.kelas, rombel: s.rombel, noInduk: s.noInduk, username: s.username, password: s.password
      })));
    }

    if (action === 'importSiswa' && req.method === 'POST') {
      const { dataRows } = req.body;
      const batchData = [];
      dataRows.forEach(row => {
        if (row[1] && row[1].trim() !== "") {
          const studentId = "S-" + Math.floor(100000 + Math.random() * 900000);
          const namaDepan = row[1].split(" ")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
          const username = namaDepan + Math.floor(100 + Math.random() * 900);
          const password = Math.random().toString(36).substring(2, 8).toUpperCase();
          batchData.push({
            studentId, sekolah: row[0], nama: row[1], tanggalLahir: row[2],
            kelas: row[3], rombel: row[4], noInduk: row[5], username, password
          });
        }
      });
      if (batchData.length > 0) await supabase.from('siswa').insert(batchData);
      return res.status(200).json("SUCCESS");
    }

    if (action === 'getReferensi') {
      const { data } = await supabase.from('referensi').select('*');
      const kelas = [...new Set((data || []).map(r => r.Kelas).filter(Boolean))].sort();
      const mapel = [...new Set((data || []).map(r => r['Mata Pelajaran']).filter(Boolean))].sort();
      return res.status(200).json({ kelas, mapel });
    }

    if (action === 'getRiwayatUjian') {
      const { data } = await supabase.from('riwayat_ujian').select('*').order('waktu', { ascending: false });
      return res.status(200).json(data || []);
    }

    if (action === 'simpanUjian' && req.method === 'POST') {
      const { token, kelas, mapel, durasi } = req.body;
      await supabase.from('riwayat_ujian').insert([{ token, waktu: new Date().toISOString(), kelas, mapel, durasi, status: 'NONAKTIF' }]);
      return res.status(200).json("SUCCESS");
    }

    if (action === 'setUjianStatus' && req.method === 'POST') {
      const { token, status } = req.body;
      await supabase.from('riwayat_ujian').update({ status }).eq('token', token);
      return res.status(200).json("SUCCESS");
    }

    if (action === 'hapusUjian' && req.method === 'POST') {
      const { token } = req.body;
      await supabase.from('riwayat_ujian').delete().eq('token', token);
      return res.status(200).json("SUCCESS");
    }

    if (action === 'cekKetersediaanSoal') {
      const { kelas, mapel } = req.query;
      const { count } = await supabase.from('soal').select('*', { count: 'exact', head: true }).eq('Kelas', kelas).eq('Mapel', mapel).eq('status', 'AKTIF');
      return res.status(200).json(count || 0);
    }

    if (action === 'getSiswaAktif') {
      const { data: active } = await supabase.from('active_sessions').select('*').order('last_ping', { ascending: false }).limit(100);
      const studentIds = (active || []).map(a => a.student_id);
      const { data: siswa } = await supabase.from('siswa').select('studentId, sekolah, nama').in('studentId', studentIds);
      const mapSiswa = {};
      (siswa || []).forEach(s => mapSiswa[s.studentId] = s);

      const hasil = (active || []).map(a => ({
        studentId: a.student_id,
        sekolah: mapSiswa[a.student_id]?.sekolah || '-',
        nama: mapSiswa[a.student_id]?.nama || 'Tidak Dikenal',
        kelas: a.kelas, mapel: a.mapel, token: a.token, status: a.status, lastPing: a.last_ping
      }));
      return res.status(200).json(hasil);
    }

    if (action === 'resetSiswa' && req.method === 'POST') {
      const { studentId } = req.body;
      await supabase.from('active_sessions').update({ status: 'LOGOUT (BY ADMIN)' }).eq('student_id', studentId).eq('status', 'ON_PROGRESS');
      return res.status(200).json("SUCCESS");
    }

    if (action === 'getSoalAdmin') {
      const { kls, mpl } = req.query;
      let query = supabase.from('soal').select('*');
      if (kls) query = query.eq('Kelas', kls);
      if (mpl) query = query.eq('Mapel', mpl);
      const { data } = await query;
      return res.status(200).json((data || []).map(s => ({ id: s.id_soal, pertanyaan: s.Soal, jenis: s.Jenis, status: s.Status, skor: s.Skor })));
    }

    if (action === 'importSoal' && req.method === 'POST') {
      const { dataRows } = req.body;
      const batchData = [];
      dataRows.forEach(row => {
        if (row[2] && row[2].trim() !== "") {
          const idSoal = "Q-" + Math.floor(100000 + Math.random() * 900000);
          batchData.push({
            id_soal: idSoal, Kelas: row[0], Mapel: row[1], Soal: row[2],
            opsia: row[3], opsib: row[4], opsic: row[5], opsid: row[6],
            Kunci: row[7], Tingkatan: row[8], Status: 'AKTIF', Jenis: row[9], Skor: parseFloat(row[10] || 0)
          });
        }
      });
      if (batchData.length > 0) await supabase.from('soal').insert(batchData);
      return res.status(200).json("SUCCESS");
    }

    if (action === 'hapusSoal' && req.method === 'POST') {
      const { id } = req.body;
      await supabase.from('soal').delete().eq('id_soal', id);
      return res.status(200).json("SUCCESS");
    }

    if (action === 'getRekapHasil') {
      const { data } = await supabase.from('hasil_ujian').select('*').order('waktu', { ascending: false });
      return res.status(200).json((data || []).map(h => ({
        idDb: h.id, waktu: h.waktu, studentId: h.studentId, sekolah: h.Sekolah,
        nama: h.Nama, kelas: h.Kelas, mapel: h.Mapel, pg: h['Nilai PG'], uraian: h['Nilai Uraian'], total: h['Nilai Total']
      })));
    }

    if (action === 'hapusHasil' && req.method === 'POST') {
      const { idDb } = req.body;
      await supabase.from('hasil_ujian').delete().eq('id', idDb);
      return res.status(200).json("SUCCESS");
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}