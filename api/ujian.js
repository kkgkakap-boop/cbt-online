import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function verifySession(req) {
  const sessionToken = req.headers['x-session-token'];
  if (!sessionToken) return null;
  const { data } = await supabase.from('active_sessions').select('*').eq('session_token', sessionToken).eq('status', 'ON_PROGRESS').single();
  return data;
}

export default async function handler(req, res) {
  const { action } = req.query;

  try {
    // 1. Siswa: Cek Mapel Aktif (Harus terdaftar di tabel peserta_ujian)
    if (action === 'getActiveMapel') {
      const { studentId, kelas } = req.query;
      const { data: hasil } = await supabase.from('hasil_ujian').select('mapel').eq('student_id', studentId);
      const mapelSelesai = (hasil || []).map(h => h.mapel.trim().toUpperCase());

      // Cari token ujian aktif yang mencakup student_id ini di tabel peserta_ujian
      const { data: peserta } = await supabase.from('peserta_ujian').select('token').eq('student_id', studentId);
      const tokenList = (peserta || []).map(p => p.token);

      if (tokenList.length === 0) return res.status(200).json([]);

      const { data: riwayat } = await supabase.from('riwayat_ujian').select('mapel').in('token', tokenList).eq('status', 'AKTIF');
      const mapelAktif = (riwayat || []).map(r => r.mapel.trim()).filter(m => !mapelSelesai.includes(m.toUpperCase()));
      return res.status(200).json([...new Set(mapelAktif)]);
    }

    // 2. Siswa: Check Token & Validasi Hak Akses Peserta
    if (action === 'checkToken' && req.method === 'POST') {
      const { studentId, kelas, mapel, token, nama } = req.body;
      const cleanToken = (token || '').trim().toUpperCase();

      const { data: rw } = await supabase.from('riwayat_ujian').select('*').eq('token', cleanToken).eq('kelas', kelas).eq('mapel', mapel).eq('status', 'AKTIF').maybeSingle();
      if (!rw) return res.status(200).json({ status: 'ERROR', data: 'Token tidak valid / Mata Pelajaran tidak sesuai.' });

      // Cek apakah siswa terdaftar di peserta_ujian untuk token ini
      const { data: cekPeserta } = await supabase.from('peserta_ujian').select('*').eq('token', cleanToken).eq('student_id', studentId).maybeSingle();
      if (!cekPeserta) return res.status(200).json({ status: 'ERROR', data: 'Anda tidak terdaftar untuk mengikuti ujian dengan token ini.' });

      const { data: newSess, error } = await supabase.from('active_sessions').insert([{
        student_id: studentId, kelas, mapel, token_ujian: cleanToken, status: 'ON_PROGRESS'
      }]).select('session_token').single();

      if (error) return res.status(200).json({ status: 'ERROR', data: 'Gagal membuat sesi ujian.' });

      return res.status(200).json({
        status: 'SUCCESS',
        data: { sessionToken: newSess.session_token, studentId, nama, kelas, mapel, token: cleanToken, durasi: rw.durasi }
      });
    }

    // 3. Siswa: Ambil Soal
    if (action === 'getSoal') {
      const sess = await verifySession(req);
      if (!sess) return res.status(403).json({ status: 'ERROR', data: 'Sesi tidak valid.' });

      const { data: soalList } = await supabase.from('soal')
        .select('id, pertanyaan, opsi_a, opsi_b, opsi_c, opsi_d, jenis, skor')
        .eq('kelas', sess.kelas)
        .eq('mapel', sess.mapel)
        .eq('status', 'AKTIF')
        .order('nomor_urut', { ascending: true });

      const formatted = (soalList || []).map(s => ({
        id: s.id, pertanyaan: s.pertanyaan,
        opsiA: s.opsi_a, opsiB: s.opsi_b, opsiC: s.opsi_c, opsiD: s.opsi_d,
        jenis: s.jenis, skor: s.skor
      }));

      return res.status(200).json({ status: 'SUCCESS', data: { soal: formatted, progress: sess.progress } });
    }

    if (action === 'ping' && req.method === 'POST') {
      const sess = await verifySession(req);
      if (!sess) return res.status(403).json({ status: 'ERROR', data: 'Unauthorized' });
      const { jawaban, ragu, lastIndex } = req.body;
      const payload = { last_ping: new Date().toISOString() };
      if (jawaban !== undefined) payload.progress = { jawaban, ragu, lastIndex };
      await supabase.from('active_sessions').update(payload).eq('session_token', sess.session_token);
      return res.status(200).json({ status: 'OK' });
    }

    if (action === 'getStartTime') {
      const sess = await verifySession(req);
      if (!sess) return res.status(403).json({ startTime: Date.now() });
      const { data: riw } = await supabase.from('riwayat_ujian').select('durasi').eq('token', sess.token_ujian).single();
      const durasiMs = (riw?.durasi || 60) * 60 * 1000;
      const startTimeMs = new Date(sess.start_time).getTime();
      return res.status(200).json({ startTime: startTimeMs, endTime: startTimeMs + durasiMs });
    }

    // --- ADMIN ACTIONS (MULTI-ROLE SUPPORT) ---
    const { role, sekolah } = req.query; // Dikirim dari frontend admin

    if (action === 'getDashboardData') {
      let siswaQuery = supabase.from('siswa').select('*', { count: 'exact', head: true });
      if (role === 'SEKOLAH') siswaQuery = siswaQuery.eq('sekolah', sekolah);
      const { count: totalSiswa } = await siswaQuery;

      let soalQuery = supabase.from('soal').select('*', { count: 'exact', head: true });
      if (role === 'SEKOLAH') soalQuery = soalQuery.or(`sekolah_owner.eq.${sekolah},sekolah_owner.eq.PUSAT`);
      const { count: totalSoal } = await soalQuery;

      let riwQuery = supabase.from('riwayat_ujian').select('*', { count: 'exact', head: true }).eq('status', 'AKTIF');
      if (role === 'SEKOLAH') riwQuery = riwQuery.eq('sekolah_owner', sekolah);
      const { count: ujianAktif } = await riwQuery;

      return res.status(200).json({ totalSiswa: totalSiswa || 0, totalSoal: totalSoal || 0, ujianAktif: ujianAktif || 0, siswaOnline: 0 });
    }

    if (action === 'getAllSiswa') {
      let query = supabase.from('siswa').select('*');
      if (role === 'SEKOLAH') query = query.eq('sekolah', sekolah);
      const { data } = await query;
      return res.status(200).json((data || []).map(s => ({
        studentId: s.student_id, sekolah: s.sekolah, nama: s.nama, tglLahir: s.tgl_lahir,
        kelas: s.kelas, rombel: s.rombel, noInduk: s.no_induk, gelombang: s.gelombang, sesi: s.sesi, username: s.username
      })));
    }

    if (action === 'getReferensi') {
      const { data } = await supabase.from('referensi').select('*');
      const kelas = [...new Set((data || []).filter(r => r.jenis === 'kelas').map(r => r.nilai))].sort();
      const mapel = [...new Set((data || []).filter(r => r.jenis === 'mapel').map(r => r.nilai))].sort();
      return res.status(200).json({ kelas, mapel });
    }

    // Fitur Utama: Admin Sekolah Mengaktifkan Ujian & Centang Peserta
    if (action === 'simpanUjianAktif' && req.method === 'POST') {
      const { token, kelas, mapel, durasi, gelombang, sesi, sekolahOwner, selectedStudentIds } = req.body;

      // 1. Simpan ke riwayat_ujian
      await supabase.from('riwayat_ujian').insert([{
        token, kelas, mapel, durasi, status: 'AKTIF',
        sekolah_owner: sekolahOwner || 'PUSAT',
        target_gelombang: gelombang,
        target_sesi: sesi
      }]);

      // 2. Masukkan siswa yang dicentang ke tabel peserta_ujian
      if (selectedStudentIds && selectedStudentIds.length > 0) {
        const batchPeserta = selectedStudentIds.map(id => ({ token, student_id: id }));
        await supabase.from('peserta_ujian').insert(batchPeserta);
      }

      return res.status(200).json({ status: 'SUCCESS', token });
    }

    if (action === 'getRiwayatUjian') {
      let query = supabase.from('riwayat_ujian').select('*').order('waktu', { ascending: false });
      if (role === 'SEKOLAH') query = query.eq('sekolah_owner', sekolah);
      const { data } = await query;
      return res.status(200).json(data || []);
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

    if (action === 'getRekapHasil') {
      let query = supabase.from('hasil_ujian').select('*').order('waktu', { ascending: false });
      if (role === 'SEKOLAH') query = query.eq('sekolah', sekolah);
      const { data } = await query;
      return res.status(200).json((data || []).map(h => ({
        idDb: h.id, waktu: h.waktu, studentId: h.student_id, sekolah: h.sekolah,
        nama: h.nama, kelas: h.kelas, mapel: h.mapel, pg: h.pg_score, total: h.total_score
      })));
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    return res.status(500).json({ error: 'Server Error' });
  }
}