#include <sys/ptrace.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <unistd.h>
//#include <linux/user.h>   /* For constants ORIG_EAX etc */
#include <linux/elf.h>
#include <sys/reg.h>
#include <sys/syscall.h> /* For SYS_write etc */
#include <sys/user.h>

#include <assert.h>
#include <cpuid.h>
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <iomanip>
#include <iostream>
#include <memory>
#include <regex>
#include <sstream>
#include <string>
#include <vector>
/*
   we encapsulate following operation into a HTTP service

    $ gcc -g -no-pie -nostdlib hello.s -o a1.out
    $ objdump -d -l -w a1.out
    $     capture all objdump result
    $ ./a.out ./a1.out > 1.txt

   all these data will be returned to js front-end for render

   ==========================================================
   Above solution requires more effort, a simpler one is

    $ ./trace_regs hello.s

   trace_regs will do both "gcc" && "objdump" & "ptrace", and combine
   the result together into a clean format:

   the changed register will be logged after each instruction as comment
   interleaved with objdump.


*/
// Objdump to get mapping between RIP and source code
struct objdump_line {
  // 4000d4:	f3 0f 6f 04 25 07 01 40 00 	movdqu 0x400107,%xmm0
  unsigned long rip;
  std::string mcode;
  std::string src_code;

  // src file line number
  int line;
  const char *asm_path;
};

std::ostream &operator<<(std::ostream &os, objdump_line const &odl) {
  return os << odl.asm_path << ":" << std::dec << odl.line << "  " << std::hex
            << odl.rip << ":  " << std::setw(20) << std::left << odl.src_code
            << "    #" << odl.mcode;
}

unsigned int xsave_size;
unsigned int avx_state_off;

struct asm_analyzer {
  const char *asm_path;
  const char *exe_path;
  std::vector<objdump_line> objdumps;
  std::map<int, int> objdump_map;
  bool debug;

  asm_analyzer(const char *asm_path, const char *exe_path, bool debug = false)
      : asm_path(asm_path), exe_path(exe_path), debug(debug) {
    gcc();
    objdump();
  };

  void gcc() {
    std::string cmd;
    std::ostringstream g;
    g << "gcc -g -no-pie -nostdlib " << asm_path << " -o " << exe_path;
    cmd = g.str();

    // sprintf(cmd, "gcc -g -no-pie -nostdlib %s -o %s", asm_path, exe_path);
    int status = system(cmd.c_str());
    if (status) {
      std::ostringstream errmsg;
      errmsg << "failed to compile " << asm_path << "  with following command "
             << cmd;
      throw std::runtime_error(errmsg.str());
    }
    printf("[asm_analyzer] assembly source & executable:  %s  %s\n", asm_path,
           exe_path);
    printf("[asm_analyzer] compilation: %s\n", cmd.c_str());
  }

  void objdump() {
    std::string buffer;
    buffer.resize(1024);

    std::string cmd("objdump -d -l -w -M intel ");
    cmd += exe_path;
    std::unique_ptr<FILE, decltype(&pclose)> pipe(popen(cmd.c_str(), "r"),
                                                  pclose);
    if (!pipe)
      throw std::runtime_error("failed to run command:" + cmd);

    // https://en.cppreference.com/w/cpp/language/string_literal
    // /\/hello.s:(\d+)\n\s+([\da-fA-F]+):\s((?:[\da-fA-F]{2}\s)+)\s(.*)/g
    // XXX delimiter is optional, when you want to include raw sequence )" in
    // your literal, you can add this optional user-defined delimiter sequence
    // to make )XXX" as the acutal raw string literal end.
    std::regex regex_linenumber(std::string(asm_path) + R"XXX(:(\d+)\n)XXX");
    std::regex regex_rip_mcode_dis(
        R"XXX(\s+([\da-fA-F]+):\s((?:[\da-fA-F]{2}\s)+)\s+(.*))XXX");

    int cur_src_line = 0;
    while (fgets(&buffer[0], buffer.capacity(), pipe.get())) {
      std::smatch match;
      if (std::regex_search(buffer, match, regex_linenumber)) {
        cur_src_line = std::stoi(match[1]);
        continue;
      }

      if (std::regex_search(buffer, match, regex_rip_mcode_dis)) {
        objdump_line odl;
        odl.line = cur_src_line;
        odl.rip = std::stol(match[1], 0, 16);
        odl.mcode = match[2];
        odl.src_code = match[3];
        odl.asm_path = asm_path;
        objdumps.push_back(odl);
        objdump_map[odl.rip] = objdumps.size() - 1;
      }
    }

    if (debug) {
      std::cout << "=================OBJDUMP================" << std::endl;
      for (auto &odl : objdumps)
        std::cout << odl << std::endl;
    }
    printf("[asm_analyzer] disassemble: %s\n", cmd.c_str());
  }

  struct user_regs_struct cur_regs {};
  std::vector<char> cur_xsave;

  // each step
  void step(struct user_regs_struct &regs, std::vector<char> &xsave) {

#define CHECK_REG(r)                                                           \
  if (regs.r != cur_regs.r) {                                                  \
    printf("\t" #r "=0x%llx\n", regs.r);                                       \
  }
    CHECK_REG(rax);
    CHECK_REG(rbx);
    CHECK_REG(rcx);
    CHECK_REG(rdx);
    CHECK_REG(rsi);
    CHECK_REG(rdi);
    CHECK_REG(rbp);
    CHECK_REG(rsp);
    CHECK_REG(r8);
    CHECK_REG(r9);
    CHECK_REG(r10);
    CHECK_REG(r11);
    CHECK_REG(r12);
    CHECK_REG(r13);
    CHECK_REG(r14);
    CHECK_REG(r15);
    // CHECK_REG(rip);
    if (regs.eflags != cur_regs.eflags) {
      enum x86_FLAGS {
        CarryFlag = 1 << 0,
        ParityFlag = 1 << 2,
        AuxCarryFlag = 1 << 4,
        ZeroFlag = 1 << 6,
        OverflowFlag = 1 << 11,
      };

      printf("\teflags=0x%llx [", regs.eflags);

      auto changed = regs.eflags ^ cur_regs.eflags;

#define CHECK_EFLAG_CHANGES(flag, name)                                        \
  if (changed & flag)                                                          \
    printf(" %c%s ", (regs.eflags & flag) ? '+' : '-', name);                  \
  else if (regs.eflags & flag)                                                 \
    printf(" %s ", name);

      CHECK_EFLAG_CHANGES(CarryFlag, "CF");
      CHECK_EFLAG_CHANGES(AuxCarryFlag, "AF");
      CHECK_EFLAG_CHANGES(ZeroFlag, "ZF");
      CHECK_EFLAG_CHANGES(OverflowFlag, "OF");
      printf("]\n");
    }

    if (cur_xsave.size() == 0)
      cur_xsave = xsave;

    struct xmm {
      unsigned int v[4];
      bool operator!=(const xmm &b) const {
        return v[0] != b.v[0] || v[1] != b.v[1] || v[2] != b.v[2] ||
               v[3] != b.v[3];
      }
      float *as_float() { return reinterpret_cast<float *>(v); }
    };

    {
      xmm *x1 = reinterpret_cast<xmm *>(&xsave[avx_state_off]);
      xmm *x1_last = reinterpret_cast<xmm *>(&cur_xsave[avx_state_off]);

      xmm *x0 = reinterpret_cast<xmm *>(&xsave[160]);
      xmm *x0_last = reinterpret_cast<xmm *>(&cur_xsave[160]);

      for (int i = 0; i < 16; i++) {
        float *p1 = x1[i].as_float();
        float *p0 = x0[i].as_float();
        unsigned int *i1 = x1[i].v;
        unsigned int *i0 = x0[i].v;

        if (x1[i] != x1_last[i]) {
          printf("\tymm%d = (%f,%f,%f,%f,%f,%f,%f,%f)"
                 "\t0x%08x 0x%08x 0x%08x 0x%08x 0x%08x 0x%08x 0x%08x 0x%08x\n",
                 i, p0[0], p0[1], p0[2], p0[3], p1[0], p1[1], p1[2], p1[3],
                 i0[0], i0[1], i0[2], i0[3], i1[0], i1[1], i1[2], i1[3]);
        } else if (x0[i] != x0_last[i]) {
          printf("\txmm%d = (%f,%f,%f,%f)"
                 "\t0x%08x 0x%08x 0x%08x 0x%08x\n",
                 i, p0[0], p0[1], p0[2], p0[3], i0[0], i0[1], i0[2], i0[3]);
        }
      }
    };

    cur_regs = regs;
    cur_xsave = xsave;

    auto it_odl = objdump_map.find(regs.rip);
    if (it_odl != objdump_map.end()) {
      objdump_line &odl = objdumps[it_odl->second];
      std::cout << odl << std::endl;
      if (odl.src_code.find("syscall") != std::string::npos) {
        std::ostringstream g;
        g << "Tracee is not allowed to do syscall!";
        throw std::runtime_error(g.str());
      }
    } else {
      std::ostringstream g;
      g << "Tracee is running at unknown RIP: 0x" << std::hex << regs.rip;
      throw std::runtime_error(g.str());
    }
  }
};

int main(int argc, char *argv[]) {
  pid_t child;
  int err, wstatus;
  ;
  // in __x86_64__ sizeof(long) is 8
  // in 32 mode, sizeof(long) is 4
  // so long is perfect for representing register
  // linux kernel rely on this "unsigned long" for such purpose
  long orig_rax;
  struct user_regs_struct regs;
  struct iovec iov;
  const char *asm_path = argv[1];
  const char *exe_path = argv[2];
  const long max_steps = 1000;

  if (exe_path == NULL)
    exe_path = "./a1.out";

  asm_analyzer aa(asm_path, exe_path, false);

  {
    unsigned int eax, ebx, ecx, edx;

    if (!__get_cpuid(0x01, &eax, &ebx, &ecx, &edx) || !(ecx & bit_AVX))
      throw std::runtime_error("AVX not supported\n");

    enum XSAVE_area {
      BaseState = 0,
      AVXState = 2,
    };

    /* get the size of the XSAVE Area */
    if (!__get_cpuid_count(0x0d, BaseState, &eax, &ebx, &ecx, &edx))
      throw std::runtime_error("__get_cpuid_count failed\n");
    xsave_size = ebx;

    /* get the size of the AVX state */
    if (!__get_cpuid_count(0x0d, AVXState, &eax, &ebx, &ecx, &edx))
      throw std::runtime_error("__get_cpuid_count failed\n");
    avx_state_off = ebx;
  }

  printf("xsave_size = %d bytes, avx_state_off=%d\n", xsave_size,
         avx_state_off);

  std::vector<char> xsave_buf(xsave_size);

  child = fork();
  if (child == 0) {
    ptrace(PTRACE_TRACEME, 0, NULL, NULL);

    printf("tracee: I'm %ld\n", syscall(__NR_gettid));

    execl(exe_path, exe_path, NULL);
    // execl("/bin/ls", "ls", "-l", "/proc/self/task/", NULL);
  } else {
    // wait for child process's state change
    printf("[asm_analyzer] child process %d start...\n", child);

    try {
      long step;

      for (step = 0; step < max_steps; step++) {
        wait(&wstatus);

        if (WIFEXITED(wstatus)) {
          printf("[asm_analyzer] child process %d exit normally with code %d\n",
                 child, WEXITSTATUS(wstatus));
          break;
        }

        if (WIFSIGNALED(wstatus)) {
          printf("[asm_analyzer] child process %d was terminated by signal %d: "
                 "%s\n",
                 child, WTERMSIG(wstatus), strsignal(WSTOPSIG(wstatus)));
          break;
        }

        if (!WIFSTOPPED(wstatus)) {
          printf("[asm_analyzer] child process %d was not stopped on wait, "
                 "continue...!\n",
                 child);
          continue;
        }

        int sig = WSTOPSIG(wstatus);
        if (sig != SIGTRAP) {
          printf(
              "[asm_analyzer] child process %d was stopped by signal %d: %s\n",
              child, WSTOPSIG(wstatus), strsignal(WSTOPSIG(wstatus)));
          break;
        }

        // PTRACE_PEEKUSER: Return the word in the process's user area at offset
        // ADDR
        //     arch/ia64/kernel/ptrace.c:
        //            access_uarea // read the word at addr in the USER area
        // user area is a kernel data structure, but the definition is exposed
        // to GDB user-app through <sys/user.h>, and the accessing from
        // user-space is also exposed through PTRACE_PEEKUSER/PTRACE_POKEUSER

        err = ptrace(PTRACE_GETREGS, child, NULL, &regs);
        if (err)
          throw std::runtime_error("PTRACE_GETREGS");

        iov.iov_base = xsave_buf.data();
        iov.iov_len = xsave_buf.size();
        err = ptrace(PTRACE_GETREGSET, child, NT_X86_XSTATE, &iov);
        if (err)
          throw std::runtime_error("PTRACE_GETREGSET");

        aa.step(regs, xsave_buf);

        /*
        if (regs.orig_rax == SYS_execve)
          std::cout << "tracer: tracee calls SYS_execve, stepping...\n";
        */
        ptrace(PTRACE_SINGLESTEP, child, NULL, NULL);
        // ptrace(PTRACE_CONT, child, NULL, NULL);
      }

      if (step >= max_steps)
        printf("[asm_analyzer] the program exceeds max steps allowed : %ld\n",
               step);

    } catch (std::exception &e) {
      printf("[asm_analyzer] exception : %s\n", e.what());
    }
  }
  return 0;
}
