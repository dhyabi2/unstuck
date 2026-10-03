const RPC = "https://rpc.nano.to";
const acct = process.argv[2];
if (!acct) { console.error("usage: node check-account.js <nano_addr>"); process.exit(2); }
async function rpc(body) {
  const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
(async () => {
  const info = await rpc({ action: "account_info", account: acct }).catch(e => ({ error: e.message }));
  console.log("account_info:", JSON.stringify(info));
  const recv = await rpc({ action: "receivable", account: acct, count: "10", threshold: "1" }).catch(e => ({ error: e.message }));
  console.log("receivable:", JSON.stringify(recv));
})();
