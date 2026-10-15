const $ = (id) => document.getElementById(id);

      const SUPABASE_URL = "https://tnvofnpkqoaituwkzxcm.supabase.co";
      const SUPABASE_ANON_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRudm9mbnBrcW9haXR1d2t6eGNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMzYwNTMsImV4cCI6MjA5OTgxMjA1M30._qAitIIaFr5MTbgof3MZuF19kG2W4IZnvu3A4yXL1sg";

      const supabaseClient = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
      );

      const SOON_DAYS = 3;
      let loans = [];
      let toast;

      function showToast(msg) {
        $("toastBody").textContent = msg;
        toast.show();
      }

      function escapeHtml(value) {
        const div = document.createElement("div");
        div.textContent = value || "";
        return div.innerHTML;
      }

      /* Days from today until the due date (negative = overdue, null = no due date) */
      function daysUntil(dueDate) {
        if (!dueDate) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const due = new Date(dueDate + "T00:00:00");
        return Math.round((due - today) / 86400000);
      }

      function loanStatus(loan) {
        const d = daysUntil(loan.dueDate);
        if (d === null) return "ok";
        if (d < 0) return "overdue";
        if (d <= SOON_DAYS) return "soon";
        return "ok";
      }

      function dueLabel(loan) {
        const d = daysUntil(loan.dueDate);
        if (d === null) return "No due date";
        if (d < 0)
          return `${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} overdue`;
        if (d === 0) return "Due today";
        if (d === 1) return "Due tomorrow";
        return `In ${d} days`;
      }

      function fmtDate(str) {
        if (!str) return "—";
        return new Date(str + "T00:00:00").toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
      }

      async function loadLoans() {
        const { data, error } = await supabaseClient
          .from("loans")
          .select("*")
          .order("due_date", { ascending: true, nullsFirst: false });

        if (error) {
          console.error("Load loans failed:", error);
          showToast("Could not load loans.");
          loans = [];
          return;
        }

        loans = data.map((r) => ({
          id: r.id,
          itemId: r.item_id,
          itemRef: r.item_ref,
          itemName: r.item_name,
          borrower: r.borrower,
          qty: r.qty,
          date: r.date,
          dueDate: r.due_date,
          purpose: r.purpose,
        }));
      }

      function render() {
        const search = $("searchInput").value.trim().toLowerCase();
        const statusFilter = $("statusFilter").value;

        /* Stats use all loans, not the filtered list */
        $("statActive").textContent = loans.length;
        $("statUnits").textContent = loans.reduce(
          (s, l) => s + Number(l.qty || 0),
          0,
        );
        $("statSoon").textContent = loans.filter(
          (l) => loanStatus(l) === "soon",
        ).length;
        $("statOverdue").textContent = loans.filter(
          (l) => loanStatus(l) === "overdue",
        ).length;

        const filtered = loans.filter((l) => {
          if (statusFilter && loanStatus(l) !== statusFilter) return false;
          if (search) {
            const hay = [l.borrower, l.itemName, l.itemRef, l.purpose]
              .join(" ")
              .toLowerCase();
            if (!hay.includes(search)) return false;
          }
          return true;
        });

        const body = $("loansBody");
        const empty = $("emptyState");

        if (filtered.length === 0) {
          body.innerHTML = "";
          empty.classList.remove("d-none");
          $("emptyTitle").textContent =
            loans.length === 0
              ? "Nothing is borrowed right now"
              : "No loans match your filters";
          return;
        }

        empty.classList.add("d-none");
        body.innerHTML = filtered
          .map((l) => {
            const status = loanStatus(l);
            return `
          <tr class="${status === "overdue" ? "is-overdue" : ""}">
            <td><span class="ref-badge">${escapeHtml(l.itemRef)}</span></td>
            <td><div class="loan-borrower">${escapeHtml(l.borrower) || "Unspecified"}</div></td>
            <td><div class="item-name">${escapeHtml(l.itemName)}</div></td>
            <td class="mono fw-bold">${l.qty}</td>
            <td class="loan-date">${fmtDate(l.date)}</td>
            <td>
              <div class="loan-date">${fmtDate(l.dueDate)}</div>
              <span class="status-${status}">
                <span class="status-dot"></span>
                <span class="status-text">${dueLabel(l)}</span>
              </span>
            </td>
            <td class="loan-purpose">${escapeHtml(l.purpose) || '<span class="text-secondary">—</span>'}</td>
            <td class="text-end">
              <button class="btn btn-sm btn-outline-copper" onclick="returnLoan('${l.id}')">
                <i class="bi bi-arrow-return-left me-1"></i>Return
              </button>
            </td>
          </tr>`;
          })
          .join("");
      }

      async function returnLoan(loanId) {
        const loan = loans.find((l) => l.id === loanId);
        if (!loan) return;
        if (
          !confirm(
            `Mark ${loan.qty} × ${loan.itemName} as returned by ${loan.borrower || "borrower"}?`,
          )
        )
          return;

        /* Fetch the live quantity so concurrent changes aren't overwritten */
        const { data: itemRow } = await supabaseClient
          .from("items")
          .select("qty")
          .eq("id", loan.itemId)
          .maybeSingle();

        if (itemRow) {
          const newQty = Number(itemRow.qty) + Number(loan.qty);
          const { error } = await supabaseClient
            .from("items")
            .update({ qty: newQty })
            .eq("id", loan.itemId);
          if (error) {
            console.error(error);
            return showToast("Could not restore stock.");
          }
        }

        const { error: delErr } = await supabaseClient
          .from("loans")
          .delete()
          .eq("id", loanId);
        if (delErr) {
          console.error(delErr);
          return showToast("Could not close the loan.");
        }

        loans = loans.filter((l) => l.id !== loanId);
        render();
        showToast("Returned — stock updated.");
      }

      function clearFilters() {
        $("searchInput").value = "";
        $("statusFilter").value = "";
        render();
      }

      $("searchInput").addEventListener("input", render);
      $("statusFilter").addEventListener("change", render);

      (async function init() {
        toast = new bootstrap.Toast($("toastMsg"), { delay: 3000 });
        await loadLoans();
        render();

        supabaseClient
          .channel("borrowers-changes")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "loans" },
            async () => {
              await loadLoans();
              render();
            },
          )
          .subscribe();
      })();