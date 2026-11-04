import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

async function callGemini(soal, jawaban) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Anda adalah guru penilai. Berikan nilai 0-100 untuk jawaban siswa berikut. HANYA KELUARKAN ANGKA SAJA (Contoh: 85). Soal: ${soal} Jawaban Siswa: ${jawaban}`;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const angka = parseInt(text.replace(/[^0-9]/g, ''));
    return isNaN(angka) ? 0 : angka;
  } catch (e) {
    return 0;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ status: 'ERROR', data: 'Method not allowed' });

  const { sessionId, studentId, jawaban } = req.body;

  try {
    const { data: activeSess } = await supabase.from('active_sessions').select('*').eq('session_id', sessionId).single();
    if (!activeSess) return res.status(200).json({ status: 'ERROR', data: 'Sesi tidak ditemukan.' });

    const { data: siswa } = await supabase.from('siswa').select('sekolah, nama').eq('studentId', studentId).single();
    const nmSiswa = siswa?.nama || "-";
    const skSiswa = siswa?.sekolah || "-";

    const { data: listSoal } = await supabase
      .from('soal')
      .select('*')
      .eq('Kelas', activeSess.kelas)
      .eq('Mapel', activeSess.mapel)
      .eq('Status', 'AKTIF');

    let pgScore = 0;
    let urScore = 0;
    let urDetail = {};
    let pgDetail = {};

    for (let s of (listSoal || [])) {
      let idS = String(s.id_soal).trim();
      let uAns = (jawaban[idS] || "").toString().trim();
      let jns = String(s.Jenis).toUpperCase();
      let bbt = parseFloat(s.Skor || 0);

      if (jns === 'PG') {
        pgDetail[idS] = uAns;
        if (uAns.toUpperCase() === String(s.Kunci).trim().toUpperCase()) {
          pgScore += bbt;
        }
      } else if (jns === 'U') {
        urDetail[idS] = uAns;
        if (uAns !== "") {
          let nAI = await callGemini(s.Soal, uAns);
          urScore += (nAI / 100) * bbt;
        }
      }
    }

    let total = Math.round(pgScore + urScore);

    await supabase.from('hasil_ujian').insert([{
      waktu: new Date().toISOString(),
      studentId: studentId,
      Sekolah: skSiswa,
      Nama: nmSiswa,
      Kelas: activeSess.kelas,
      Mapel: activeSess.mapel,
      'Pilihan Ganda': JSON.stringify(pgDetail),
      'jawaban uraian': JSON.stringify(urDetail),
      'Nilai PG': pgScore,
      'Nilai Uraian': urScore,
      'Nilai Total': total
    }]);

    await supabase.from('active_sessions').update({ status: 'SELESAI' }).eq('session_id', sessionId);

    return res.status(200).json({
      status: 'SUCCESS',
      data: { nilaiPG: pgScore, nilaiUraian: urScore, nilaiTotal: total }
    });
  } catch (err) {
    return res.status(500).json({ status: 'ERROR', data: err.message });
  }
}