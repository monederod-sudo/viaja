const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// === CONFIGURACIÓN DE SUPABASE ===
const supabaseUrl = 'https://zwttelekesidzebzemhi.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3dHRlbGVrZXNpZHplYnplbWhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAwMDgwNzUsImV4cCI6MjA3NTU4NDA3NX0.wPgPxellU5IorwrsgOjAHyMGVpg5wGnapCfLDHc7hZM';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// === CONFIGURACIÓN DE CORREO (Gmail) ===
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'monederodh@gmail.com',
    pass: 'vqsxhlkqlyykdrzz' // Reemplaza con tu contraseña de app
  }
});

// === RUTA DE SALUD ===
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Backend conectado y funcionando.' });
});

// === OBTENER NÚMEROS OCUPADOS ===
app.get('/api/ocupados', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('participaciones')
      .select('numeros, estado, timestamp');

    if (error) throw error;

    const TREINTA_MINUTOS = 30 * 60 * 1000;
    const ahora = Date.now();

    const ocupados = new Set(
      data
        .filter(p => 
          p.estado === 'confirmado' || 
          (p.estado === 'pendiente' && p.timestamp > ahora - TREINTA_MINUTOS)
        )
        .flatMap(p => p.numeros || [])
    );

    res.json({ numeros: [...ocupados] });
  } catch (err) {
    console.error('❌ Error al obtener números ocupados:', err.message || err);
    res.status(500).json({ error: 'Error al obtener números ocupados.' });
  }
});

// === NUEVA RUTA: OBTENER PARTICIPACIONES PENDIENTES ===
app.get('/api/pendiente', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('participaciones')
      .select('*');
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    console.error('Error al obtener pendientes:', err.message || err);
    res.status(500).json({ error: 'Error al obtener pendientes' });
  }
});

// === REGISTRAR PARTICIPACIÓN ===
app.post('/api/reservar', async (req, res) => {
  const { nombre, telefono, correo, numeros, referencia, fecha, timestamp } = req.body;

  if (!nombre || !telefono || !correo || !referencia || !fecha || !timestamp || !Array.isArray(numeros) || numeros.length < 2) {
    return res.status(400).json({ error: 'Faltan datos o números insuficientes.' });
  }

  try {
    const { data: todas, error: errCheck } = await supabase
      .from('participaciones')
      .select('numeros');

    if (errCheck) throw errCheck;

    const ocupados = new Set(todas.flatMap(p => p.numeros || []));
    const repetidos = numeros.filter(n => ocupados.has(n));
    if (repetidos.length > 0) {
      return res.status(409).json({ error: `Números ya usados: ${repetidos.join(', ')}` });
    }

    const { data, error } = await supabase
      .from('participaciones')
      .insert([
        {
          nombre,
          telefono,
          correo,
          numeros,
          referencia,
          fecha,
          estado: 'pendiente',
          timestamp
        }
      ])
      .select();

    if (error) throw error;

    await transporter.sendMail({
      from: '"Gana y Viaja" <monederodh@gmail.com>',
      to: correo,
      subject: '📄 Comprobante recibido - Pendiente de validación',
      html: `<h2>📄 ¡Tu comprobante ha sido recibido!</h2>
             <p>Hola <strong>${nombre}</strong>,</p>
             <p>Hemos recibido tu comprobante de pago. Nuestro equipo lo está revisando.</p>
             <p><strong>Números jugados:</strong> ${numeros.map(n => `<span style="background:#e3f2fd; padding:4px 8px; border-radius:4px; margin:2px;">${n}</span>`).join(' ')}</p>
             <p>Te notificaremos por correo cuando tu participación sea validada.</p>
             <p>Gracias por participar en <strong>Gana y Viaja</strong> 🎉</p>`
    });

    res.status(201).json({ id: data[0].id });
  } catch (err) {
    console.error('❌ Error al registrar:', err.message || err);
    res.status(500).json({ error: 'Error al registrar participación.' });
  }
});

// === VALIDAR PARTICIPACIÓN ===
app.post('/api/participacion/:id/validar', async (req, res) => {
  const { id } = req.params;

  try {
    const { data: participacion, error: fetchError } = await supabase
      .from('participaciones')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !participacion) {
      return res.status(404).json({ error: 'Participación no encontrada.' });
    }

    if (participacion.estado === 'confirmado') {
      return res.status(400).json({ error: 'Esta participación ya fue validada.' });
    }

    const { error: updateError } = await supabase
      .from('participaciones')
      .update({ estado: 'confirmado' })
      .eq('id', id);

    if (updateError) throw updateError;

    await transporter.sendMail({
      from: '"Gana y Viaja" <monederodh@gmail.com>',
      to: participacion.correo,
      subject: '✅ ¡Tu participación ha sido validada!',
      html: `<h2>✅ ¡Tu participación ha sido validada!</h2>
             <p>Hola <strong>${participacion.nombre}</strong>,</p>
             <p>Tu pago ha sido verificado y tus números están confirmados:</p>
             <p><strong>Números:</strong> ${participacion.numeros.map(n => `<span style="background:#1976d2; color:white; padding:4px 8px; border-radius:4px; margin:2px;">${n}</span>`).join(' ')}</p>
             <p>¡Mucha suerte en el sorteo!</p>
             <p>Equipo de <strong>Gana y Viaja</strong></p>`
    });

    res.json({ success: true, message: 'Participación validada y correo enviado.' });
  } catch (err) {
    console.error('❌ Error al validar:', err);
    res.status(500).json({ error: 'Error al validar la participación.' });
  }
});

// === RECHAZAR PARTICIPACIÓN ===
app.post('/api/participacion/:id/rechazar', async (req, res) => {
  const { id } = req.params;

  try {
    const { data: participacion, error: fetchError } = await supabase
      .from('participaciones')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !participacion) {
      return res.status(404).json({ error: 'Participación no encontrada.' });
    }

    if (participacion.estado === 'confirmado') {
      return res.status(400).json({ error: 'No se puede rechazar una participación ya validada.' });
    }

    const { error: updateError } = await supabase
      .from('participaciones')
      .update({ estado: 'rechazado' })
      .eq('id', id);

    if (updateError) throw updateError;

    await transporter.sendMail({
      from: '"Gana y Viaja" <monederodh@gmail.com>',
      to: participacion.correo,
      subject: '⚠️ Tu participación no pudo ser validada',
      html: `<h2>⚠️ Tu participación no pudo ser validada</h2>
             <p>Hola <strong>${participacion.nombre}</strong>,</p>
             <p>Lamentamos informarte que tu comprobante de pago no pudo ser verificado.</p>
             <p>Si crees que es un error, por favor envía nuevamente el comprobante desde la página web.</p>
             <p>Gracias por tu interés.</p>
             <p>Equipo de <strong>Gana y Viaja</strong></p>`
    });

    res.json({ success: true, message: 'Participación rechazada y correo enviado.' });
  } catch (err) {
    console.error('❌ Error al rechazar:', err);
    res.status(500).json({ error: 'Error al rechazar la participación.' });
  }
});

// === INICIAR SERVIDOR ===
app.listen(PORT, () => {
  console.log(`🚀 Backend corriendo en http://localhost:${PORT}`);
  console.log(`📡 Supabase URL: ${supabaseUrl}`);
});