const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// === CONFIGURACIÓN DE SUPABASE ===
const supabaseUrl = 'https://sbpsiaeeuvbzezsvdwst.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNicHNpYWVldXZiemV6c3Zkd3N0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA0MzY1NDEsImV4cCI6MjA3NjAxMjU0MX0.2WK4eDppQPe5KdcQgSS9oQRpvUH_9C_UzU8jJIEgnow';
const supabase = createClient(supabaseUrl, supabaseAnonKey);



// === Diagn�stico: prueba la conexi�n ===
(async () => {
  try {
    const { data, error } = await supabase
      .from('participantes')
      .select('id')
      .limit(1);
    
    if (error) {
      console.error('?? Error al acceder a la tabla "participantes":', error);
    } else {
      console.log('? Conexi�n a Supabase y tabla "participantes" OK. Ejemplo de dato:', data);
    }
  } catch (err) {
    console.error('?? Error inesperado al probar Supabase:', err);
  }
})();


// === CONFIGURACIÓN DE CORREO (Gmail) ===
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'monederodh@gmail.com',
    pass: 'vqsx hlkq lyyk drzz' // ⚠️ Reemplaza esto con tu contraseña de aplicación de Gmail (16 caracteres)
  }
});


// === RUTA DE SALUD ===
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Backend conectado y funcionando.' });
});

// === OBTENER N�MEROS OCUPADOS ===
app.get('/api/ocupados', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('participantes')
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
    console.error('? Error al obtener n�meros ocupados:', err.message || err);
    res.status(500).json({ error: 'Error al obtener n�meros ocupados.' });
  }
});

// === REGISTRAR PARTICIPACI�N ===
app.post('/api/pendiente', async (req, res) => {
  const { nombre, telefono, correo, numeros, referencia, fecha, timestamp } = req.body;

  if (!nombre || !telefono || !correo || !referencia || !fecha || !timestamp || !Array.isArray(numeros) || numeros.length < 2) {
    return res.status(400).json({ error: 'Faltan datos o n�meros insuficientes.' });
  }

  try {
    // Verificar duplicados en tiempo real
    const { data: todas, error: errCheck } = await supabase
      .from('participantes')
      .select('numeros');

    if (errCheck) throw errCheck;

    const ocupados = new Set(todas.flatMap(p => p.numeros || []));
    const repetidos = numeros.filter(n => ocupados.has(n));
    if (repetidos.length > 0) {
      return res.status(409).json({ error: `N�meros ya usados: ${repetidos.join(', ')}` });
    }

    // Guardar en Supabase
    const { data, error } = await supabase
      .from('participantes')
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

    // ?? Enviar correo de recepci�n
    await transporter.sendMail({
      from: '"Gana y Viaja" <monederodh@gmail.com>',
      to: correo,
      subject: '?? Comprobante recibido - Pendiente de validaci�n',
      html: `<h2>?? �Tu comprobante ha sido recibido!</h2>
             <p>Hola <strong>${nombre}</strong>,</p>
             <p>Hemos recibido tu comprobante de pago. Nuestro equipo lo est� revisando.</p>
             <p><strong>N�meros jugados:</strong> ${numeros.map(n => `<span style="background:#e3f2fd; padding:4px 8px; border-radius:4px; margin:2px;">${n}</span>`).join(' ')}</p>
             <p>Te notificaremos por correo cuando tu participaci�n sea validada.</p>
             <p>Gracias por participar en <strong>Gana y Viaja</strong> ??</p>`
    });

    res.status(201).json({ id: data[0].id });
  } catch (err) {
    console.error('? Error al registrar:', err.message || err);
    res.status(500).json({ error: 'Error al registrar participaci�n.' });
  }
});

// === VALIDAR PARTICIPACI�N ===
app.post('/api/participacion/:id/validar', async (req, res) => {
  const { id } = req.params;

  try {
    const { data: participacion, error: fetchError } = await supabase
      .from('participantes')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !participacion) {
      return res.status(404).json({ error: 'Participaci�n no encontrada.' });
    }

    if (participacion.estado === 'confirmado') {
      return res.status(400).json({ error: 'Esta participaci�n ya fue validada.' });
    }

    const { error: updateError } = await supabase
      .from('participantes')
      .update({ estado: 'confirmado' })
      .eq('id', id);

    if (updateError) throw updateError;

    // ?? Enviar correo de validaci�n
    await transporter.sendMail({
      from: '"Gana y Viaja" <monederodh@gmail.com>',
      to: participacion.correo,
      subject: '? �Tu participaci�n ha sido validada!',
      html: `<h2>? �Tu participaci�n ha sido validada!</h2>
             <p>Hola <strong>${participacion.nombre}</strong>,</p>
             <p>Tu pago ha sido verificado y tus n�meros est�n confirmados:</p>
             <p><strong>N�meros:</strong> ${participacion.numeros.map(n => `<span style="background:#1976d2; color:white; padding:4px 8px; border-radius:4px; margin:2px;">${n}</span>`).join(' ')}</p>
             <p>�Mucha suerte en el sorteo!</p>
             <p>Equipo de <strong>Gana y Viaja</strong></p>`
    });

    res.json({ success: true, message: 'Participaci�n validada y correo enviado.' });
  } catch (err) {
    console.error('? Error al validar:', err);
    res.status(500).json({ error: 'Error al validar la participaci�n.' });
  }
});

// === RECHAZAR PARTICIPACI�N ===
app.post('/api/participacion/:id/rechazar', async (req, res) => {
  const { id } = req.params;

  try {
    const { data: participacion, error: fetchError } = await supabase
      .from('participantes')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !participacion) {
      return res.status(404).json({ error: 'Participaci�n no encontrada.' });
    }

    if (participacion.estado === 'confirmado') {
      return res.status(400).json({ error: 'No se puede rechazar una participaci�n ya validada.' });
    }

    const { error: updateError } = await supabase
      .from('participantes')
      .update({ estado: 'rechazado' })
      .eq('id', id);

    if (updateError) throw updateError;

    // ?? Enviar correo de rechazo
    await transporter.sendMail({
      from: '"Gana y Viaja" <monederodh@gmail.com>',
      to: participacion.correo,
      subject: '?? Tu participaci�n no pudo ser validada',
      html: `<h2>?? Tu participaci�n no pudo ser validada</h2>
             <p>Hola <strong>${participacion.nombre}</strong>,</p>
             <p>Lamentamos informarte que tu comprobante de pago no pudo ser verificado.</p>
             <p>Si crees que es un error, por favor env�a nuevamente el comprobante desde la p�gina web.</p>
             <p>Gracias por tu inter�s.</p>
             <p>Equipo de <strong>Gana y Viaja</strong></p>`
    });

    res.json({ success: true, message: 'Participaci�n rechazada y correo enviado.' });
  } catch (err) {
    console.error('? Error al rechazar:', err);
    res.status(500).json({ error: 'Error al rechazar la participaci�n.' });
  }
});

// === RUTA RA�Z PARA EVITAR "Cannot GET /" ===
app.get('/', (req, res) => {
  res.json({ message: 'API de Gana y Viaja activa ?' });
});

// === INICIAR SERVIDOR ===
app.listen(PORT, () => {
  console.log(`?? Backend corriendo en puerto ${PORT}`);
  console.log(`?? Supabase URL: ${process.env.SUPABASE_URL}`);
});