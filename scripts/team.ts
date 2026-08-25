/**
 * Manage the internal team contacts in `app_config.crm.team` — the colleagues
 * Eli can be told to message ("שלח לסיימון…"). See lib/notify/team.ts.
 *
 * Run with the live DATABASE_URL (see CLAUDE.md "Working with Vercel + Neon"):
 *
 *   DATABASE_URL="$(~/.local/node/bin/neonctl connection-string \
 *     --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" \
 *     npx tsx scripts/team.ts list
 *
 *   … team.ts add <id> <name> <phone> <he|zh|en> "<role>" [alias,alias]
 *   … team.ts remove <id>
 *   … team.ts dm <id-or-name> "<text>"        # sends a real WhatsApp
 */
import "dotenv/config";
import {
  loadTeam,
  upsertTeamMember,
  removeTeamMember,
  sendTeamDM,
  type TeamMember,
} from "@/lib/notify/team";

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === "list") {
    const { members, updatedAt } = await loadTeam();
    if (!members.length) {
      console.log("(אין אנשי צוות רשומים)");
      return;
    }
    for (const m of members) {
      const aliases = m.aliases?.length ? ` · ${m.aliases.join(" / ")}` : "";
      console.log(`${m.id.padEnd(10)} ${m.name.padEnd(14)} +${m.phone.padEnd(14)} ${m.lang}  ${m.role}${aliases}`);
    }
    if (updatedAt) console.log(`\nעודכן: ${updatedAt}`);
    return;
  }

  if (cmd === "add") {
    const [id, name, phone, lang, role, aliases] = rest;
    if (!id || !name || !phone || !lang || !role) {
      console.error('usage: team.ts add <id> <name> <phone> <he|zh|en> "<role>" [alias,alias]');
      process.exit(1);
    }
    const member: TeamMember = {
      id: id.trim().toLowerCase(),
      name: name.trim(),
      phone: phone.replace(/[^0-9]/g, ""),
      lang: lang as TeamMember["lang"],
      role: role.trim(),
      aliases: aliases ? aliases.split(",").map((a) => a.trim()).filter(Boolean) : undefined,
    };
    const next = await upsertTeamMember(member);
    console.log(`נוסף: ${member.name} (+${member.phone}). סה״כ ${next.length}.`);
    return;
  }

  if (cmd === "remove") {
    const [id] = rest;
    if (!id) {
      console.error("usage: team.ts remove <id>");
      process.exit(1);
    }
    const next = await removeTeamMember(id.trim().toLowerCase());
    console.log(`הוסר: ${id}. נשארו ${next.length}.`);
    return;
  }

  if (cmd === "dm") {
    const [who, ...textParts] = rest;
    const text = textParts.join(" ");
    if (!who || !text) {
      console.error('usage: team.ts dm <id-or-name> "<text>"');
      process.exit(1);
    }
    const res = await sendTeamDM(who, text);
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exit(1);
    return;
  }

  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
