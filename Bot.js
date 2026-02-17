const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');
require('dotenv').config();

// ─── Environment Variables ────────────────────────────────────────────────────
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PREFIX        = process.env.PREFIX        || '!';
const BOT_STATUS    = process.env.BOT_STATUS    || '🎵 Music | !play';
const VOLUME        = parseInt(process.env.VOLUME) || 100;
const YTDLP_PATH = process.env.YTDLP_PATH || 'yt-dlp';
const EMBED_COLOR   = parseInt(process.env.EMBED_COLOR, 16) || 0xFF0000;

if (!DISCORD_TOKEN) {
  console.error('❌ Missing DISCORD_TOKEN in environment variables!');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// ─── DisTube Setup ────────────────────────────────────────────────────────────
const path = require('path');
const { execFile } = require('child_process');

const distube = new DisTube(client, {
  plugins: [new YtDlpPlugin({
    update: false,
    binaryPath: path.resolve(YTDLP_PATH),
  })],
  emitNewSongOnly: true,
  joinNewVoiceChannel: true,
  savePreviousSongs: true,
});

// Search result cache: userId -> array of YouTube URLs
const searchCache = new Map();

// Prevent MaxListeners warning
distube.setMaxListeners(20);
client.setMaxListeners(20);

// ─── Bot Ready ────────────────────────────────────────────────────────────────
client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📋 Prefix: ${PREFIX}`);
  console.log(`🔊 Default Volume: ${VOLUME}`);
  console.log(`🤖 yt-dlp path: ${path.resolve(YTDLP_PATH)}`);
  client.user.setActivity(BOT_STATUS, { type: 0 });
});

// ─── DisTube Events ───────────────────────────────────────────────────────────
distube.on('initQueue', queue => {
  queue.setVolume(VOLUME);
  console.log('✅ Queue initialized for guild:', queue.id);
});

distube.on('addList', (queue, playlist) => {
  console.log(`✅ Playlist added: ${playlist.name} (${playlist.songs.length} songs)`);
  queue.textChannel?.send(`✅ Added playlist **${playlist.name}** (${playlist.songs.length} songs) to the queue!`);
});

distube.on('addSong', (queue, song) => {
  console.log('✅ Song added:', song.name, '| URL:', song.url);
  queue.textChannel?.send(`✅ Added **${song.name}** to the queue! Position: #${queue.songs.length}`);
});

distube.on('playSong', (queue, song) => {
  console.log('▶️  Now playing:', song.name, '| URL:', song.url);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('🎵 Now Playing')
    .setDescription(`**[${song.name}](${song.url})**`)
    .addFields(
      { name: 'Duration', value: song.formattedDuration, inline: true },
      { name: 'Requested by', value: song.user?.tag || 'Unknown', inline: true },
    )
    .setThumbnail(song.thumbnail)
    .setFooter({ text: `${queue.songs.length - 1} track(s) remaining in queue` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('previous').setLabel('⏮ Prev').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('togglepause').setLabel('⏸ Pause').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('stop').setLabel('⏹ Stop').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('skip').setLabel('⏭ Skip').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('queue').setLabel('📋 Queue').setStyle(ButtonStyle.Primary),
  );

  queue.textChannel?.send({ embeds: [embed], components: [row] });
});

distube.on('finish', queue => {
  console.log('✅ Queue finished for guild:', queue.id);
  queue.textChannel?.send('✅ Queue finished! Use `!play` to add more songs.');
});

distube.on('error', (error, queue) => {
  console.error('❌ DisTube error:', error.message);
  console.error('Full error:', error);
  queue?.textChannel?.send(`❌ An error occurred: ${error.message}`);
});

distube.on('disconnect', queue => {
  console.log('👋 Disconnected from voice channel in guild:', queue?.id);
  queue?.textChannel?.send('👋 Disconnected from voice channel.');
});

distube.on('empty', queue => {
  console.log('🔇 Voice channel is empty, leaving...');
  queue?.textChannel?.send('🔇 Voice channel is empty, leaving...');
});

// ─── Message Commands ─────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (!message.author.bot) console.log(`📨 [${message.guild?.name}] ${message.author.tag}: ${message.content}`);

  if (message.author.bot || !message.guild) return;

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ── !play ──
  if (command === 'play' || command === 'p') {
    if (!args.length) return message.reply(`❌ Please provide a song name or YouTube URL.\n\`${PREFIX}play <song name or URL>\``);

    // Allow !play 1-5 to pick from last search results
    if (args.length === 1 && /^[1-5]$/.test(args[0])) {
      const cached = searchCache.get(message.author.id);
      if (!cached) return message.reply(`❌ No recent search found. Use \`${PREFIX}search <query>\` first.`);
      args[0] = cached[parseInt(args[0]) - 1];
    }

    const voiceChannel = message.member?.voice.channel;
    if (!voiceChannel) return message.reply('❌ You need to be in a voice channel!');

    const botMember = message.guild.members.me;
    const perms = voiceChannel.permissionsFor(botMember);
    if (!perms.has('Connect') || !perms.has('Speak')) {
      return message.reply('❌ I need permission to join and speak in your voice channel!');
    }

    const rawQuery = args.join(' ');
    let query = rawQuery;
    if (rawQuery.includes('youtube.com/watch') && rawQuery.includes('&')) {
      try {
        const u = new URL(rawQuery);
        const videoId = u.searchParams.get('v');
        const listId = u.searchParams.get('list');
        if (listId) {
          query = `https://www.youtube.com/playlist?list=${listId}`;
        } else {
          query = `https://www.youtube.com/watch?v=${videoId}`;
        }
        console.log('🔗 Processed URL to:', query);
      } catch { query = rawQuery; }
    }
    console.log('🔍 Attempting to play:', query, '| Voice channel:', voiceChannel.name);

    try {
      await distube.play(voiceChannel, query, {
        member: message.member,
        textChannel: message.channel,
        message,
      });
    } catch (err) {
      console.error('❌ Play error:', err.message);
      console.error(err);
      message.reply(`❌ Error: ${err.message}`);
    }
  }

  // ── !search ──
  else if (command === 'search' || command === 's') {
    if (!args.length) return message.reply(`❌ Provide a search query. \`${PREFIX}search <query>\``);
    const query = args.join(' ');
    const msg = await message.reply('🔍 Searching...');

    try {
      const ytdlpPath = path.resolve(YTDLP_PATH);

      execFile(ytdlpPath, [
        `ytsearch5:${query}`,
        '--dump-json',
        '--flat-playlist',
        '--no-warnings',
      ], (error, stdout) => {
        if (error) {
          console.error(error);
          return msg.edit('❌ Search failed. Please try again.');
        }

        const results = stdout
          .split('\n')
          .filter(line => line.trim().startsWith('{'))
          .map(line => { try { return JSON.parse(line); } catch { return null; } })
          .filter(Boolean)
          .slice(0, 5);

        if (!results.length) return msg.edit('❌ No results found.');

        // Cache the URLs for this user so !play 1-5 works
        searchCache.set(message.author.id, results.map(r => `https://www.youtube.com/watch?v=${r.id}`));

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setTitle(`🔍 Search Results for: ${query}`)
          .setDescription(
            results.map((r, i) => {
              const duration = r.duration
                ? new Date(r.duration * 1000).toISOString().substr(11, 8).replace(/^00:/, '')
                : 'Unknown';
              return `**${i + 1}.** [${r.title}](https://www.youtube.com/watch?v=${r.id})\n└ ${r.channel || 'Unknown'} • ${duration}`;
            }).join('\n\n')
          )
          .setFooter({ text: `Type ${PREFIX}play 1-5 to play a result` });

        msg.edit({ content: '', embeds: [embed] });
      });
    } catch (err) {
      console.error(err);
      msg.edit('❌ Search failed. Please try again.');
    }
  }

  // ── !skip ──
  else if (command === 'skip' || command === 'sk') {
    const queue = distube.getQueue(message.guild.id);
    if (!queue) return message.reply('❌ Nothing is playing!');
    try {
      await distube.skip(message.guild.id);
      message.reply('⏭ Skipped!');
    } catch {
      message.reply('❌ No more songs in queue.');
    }
  }

  // ── !stop ──
  else if (command === 'stop') {
    const queue = distube.getQueue(message.guild.id);
    if (!queue) return message.reply('❌ Not playing anything!');
    await distube.stop(message.guild.id);
    message.reply('⏹ Stopped and cleared the queue!');
  }

  // ── !pause ──
  else if (command === 'pause') {
    const queue = distube.getQueue(message.guild.id);
    if (!queue) return message.reply('❌ Nothing is playing!');
    if (queue.paused) {
      distube.resume(message.guild.id);
      message.reply('▶️ Resumed!');
    } else {
      distube.pause(message.guild.id);
      message.reply('⏸ Paused!');
    }
  }

  // ── !previous ──
  else if (command === 'previous' || command === 'prev') {
    const queue = distube.getQueue(message.guild.id);
    if (!queue) return message.reply('❌ Nothing is playing!');
    try {
      await distube.previous(message.guild.id);
      message.reply('⏮ Playing previous song!');
    } catch {
      message.reply('❌ No previous song available.');
    }
  }

  // ── !queue ──
  else if (command === 'queue' || command === 'q') {
    const queue = distube.getQueue(message.guild.id);
    if (!queue) return message.reply('📋 The queue is empty!');

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📋 Music Queue');

    const current = queue.songs[0];
    if (current) {
      embed.addFields({
        name: '🎵 Now Playing',
        value: `[${current.name}](${current.url}) • ${current.formattedDuration}`,
      });
    }

    const upcoming = queue.songs.slice(1);
    if (upcoming.length > 0) {
      const list = upcoming
        .slice(0, 10)
        .map((t, i) => `**${i + 1}.** [${t.name}](${t.url}) • ${t.formattedDuration}`)
        .join('\n');
      embed.addFields({ name: `Up Next (${upcoming.length} tracks)`, value: list });
      if (upcoming.length > 10) embed.setFooter({ text: `...and ${upcoming.length - 10} more` });
    }

    embed.addFields(
      { name: '🔁 Loop', value: queue.repeatMode === 1 ? 'Song' : queue.repeatMode === 2 ? 'Queue' : 'Off', inline: true },
      { name: '🔊 Volume', value: `${queue.volume}%`, inline: true },
    );

    message.reply({ embeds: [embed] });
  }

  // ── !volume ──
  else if (command === 'volume' || command === 'vol') {
    const queue = distube.getQueue(message.guild.id);
    if (!queue) return message.reply('❌ Nothing is playing!');
    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 0 || vol > 100) return message.reply('❌ Please provide a volume between 0 and 100.');
    distube.setVolume(message.guild.id, vol);
    message.reply(`🔊 Volume set to **${vol}%**`);
  }

  // ── !loop ──
  else if (command === 'loop') {
    const queue = distube.getQueue(message.guild.id);
    if (!queue) return message.reply('❌ Nothing is playing!');
    const mode = (queue.repeatMode + 1) % 3;
    distube.setRepeatMode(message.guild.id, mode);
    const modeText = mode === 0 ? 'OFF' : mode === 1 ? 'Song 🔂' : 'Queue 🔁';
    message.reply(`🔁 Loop mode: **${modeText}**`);
  }

  // ── !shuffle ──
  else if (command === 'shuffle') {
    const queue = distube.getQueue(message.guild.id);
    if (!queue) return message.reply('❌ Nothing is playing!');
    await distube.shuffle(message.guild.id);
    message.reply('🔀 Queue shuffled!');
  }

  // ── !nowplaying ──
  else if (command === 'nowplaying' || command === 'np') {
    const queue = distube.getQueue(message.guild.id);
    if (!queue) return message.reply('❌ Nothing is playing!');

    const song = queue.songs[0];
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle('🎵 Now Playing')
      .setDescription(`**[${song.name}](${song.url})**`)
      .addFields(
        { name: 'Duration', value: song.formattedDuration, inline: true },
        { name: 'Requested by', value: song.user?.tag || 'Unknown', inline: true },
      )
      .setThumbnail(song.thumbnail);

    message.reply({ embeds: [embed] });
  }

  // ── !help ──
  else if (command === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎵 Music Bot Commands')
      .setDescription(`Prefix: \`${PREFIX}\``)
      .addFields(
        { name: `\`${PREFIX}play <song/URL>\``, value: 'Play a song or add to queue', inline: true },
        { name: `\`${PREFIX}play <1-5>\``, value: 'Play a result from !search', inline: true },
        { name: `\`${PREFIX}search <query>\``, value: 'Search YouTube for songs', inline: true },
        { name: `\`${PREFIX}skip\``, value: 'Skip the current song', inline: true },
        { name: `\`${PREFIX}previous\``, value: 'Play the previous song', inline: true },
        { name: `\`${PREFIX}pause\``, value: 'Pause/resume playback', inline: true },
        { name: `\`${PREFIX}stop\``, value: 'Stop and clear queue', inline: true },
        { name: `\`${PREFIX}queue\``, value: 'Show the current queue', inline: true },
        { name: `\`${PREFIX}nowplaying\``, value: 'Show current song', inline: true },
        { name: `\`${PREFIX}loop\``, value: 'Cycle loop modes (off/song/queue)', inline: true },
        { name: `\`${PREFIX}shuffle\``, value: 'Shuffle the queue', inline: true },
        { name: `\`${PREFIX}volume <0-100>\``, value: 'Set volume', inline: true },
      );

    message.reply({ embeds: [embed] });
  }
});

// ─── Button Interactions ──────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  await interaction.deferUpdate();

  const guildId = interaction.guild.id;
  const queue = distube.getQueue(guildId);

  if (interaction.customId === 'previous') {
    if (!queue) return interaction.followUp({ content: '❌ Nothing is playing!', ephemeral: true });
    try {
      await distube.previous(guildId);
      interaction.followUp({ content: '⏮ Playing previous song!', ephemeral: true });
    } catch {
      interaction.followUp({ content: '❌ No previous song available.', ephemeral: true });
    }

  } else if (interaction.customId === 'togglepause') {
    if (!queue) return interaction.followUp({ content: '❌ Nothing is playing!', ephemeral: true });
    if (queue.paused) {
      distube.resume(guildId);
      interaction.followUp({ content: '▶️ Resumed!', ephemeral: true });
    } else {
      distube.pause(guildId);
      interaction.followUp({ content: '⏸ Paused!', ephemeral: true });
    }

  } else if (interaction.customId === 'stop') {
    if (!queue) return interaction.followUp({ content: '❌ Nothing is playing!', ephemeral: true });
    await distube.stop(guildId);
    interaction.followUp({ content: '⏹ Stopped and cleared the queue!', ephemeral: true });

  } else if (interaction.customId === 'skip') {
    if (!queue) return interaction.followUp({ content: '❌ Nothing is playing!', ephemeral: true });
    try {
      await distube.skip(guildId);
      interaction.followUp({ content: '⏭ Skipped!', ephemeral: true });
    } catch {
      interaction.followUp({ content: '❌ No more songs in queue.', ephemeral: true });
    }

  } else if (interaction.customId === 'queue') {
    if (!queue) return interaction.followUp({ content: '📋 Queue is empty.', ephemeral: true });
    const list = queue.songs.slice(1, 11);
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📋 Queue')
      .setDescription(
        list.length
          ? list.map((t, i) => `**${i + 1}.** ${t.name} • ${t.formattedDuration}`).join('\n')
          : 'No upcoming songs.'
      );
    interaction.followUp({ embeds: [embed], ephemeral: true });
  }
});

client.login(DISCORD_TOKEN);