// What Linux and macOS print for the machine stats, shared by the tests of
// herdr-app/mcc-usage/system.js and of panel.js's copy of its parsers.
"use strict";

const PROC_STAT_1 = `cpu  100 0 50 800 50 0 0 0 0 0
cpu0 50 0 25 400 25 0 0 0 0 0
intr 12345
`;
const PROC_STAT_2 = `cpu  200 0 100 1500 100 0 0 0 0 0
cpu0 100 0 50 750 50 0 0 0 0 0
`;

const MEMINFO = `MemTotal:       16384000 kB
MemFree:         1000000 kB
MemAvailable:    8192000 kB
Buffers:          200000 kB
`;

// /usr/bin/vm_stat on a 32 GB Apple silicon Mac; labels end in "." and some are quoted.
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     5501.
Pages active:                                 558273.
Pages inactive:                               556677.
Pages speculative:                               723.
Pages throttled:                                   0.
Pages wired down:                             203523.
Pages purgeable:                                8234.
"Translation faults":                     4046846847.
Pages copy-on-write:                       363549136.
File-backed pages:                            350768.
Anonymous pages:                              764905.
Pages stored in compressor:                  1482664.
Pages occupied by compressor:                 716032.
`;
const MEMSIZE = 34359738368;

// /usr/sbin/iostat -c 2 -w 1 -n 0: the first line is the average since boot.
const IOSTAT = `      cpu    load average
 us sy id   1m   5m   15m
  5  3 92  4.28 6.86 7.84
 19 12 69  3.94 6.75 7.79
`;

// eth0 and wlan0 are physical; the rest are loopback, VPNs, bridges and containers.
const NET_DEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0
  eth0: 5000 50 0 0 0 0 0 0 3000 30 0 0 0 0 0 0
   wg0: 700 7 0 0 0 0 0 0 600 6 0 0 0 0 0 0
tailscale0: 800 8 0 0 0 0 0 0 800 8 0 0 0 0 0 0
docker0: 900 9 0 0 0 0 0 0 900 9 0 0 0 0 0 0
lxdbr0: 400 4 0 0 0 0 0 0 400 4 0 0 0 0 0 0
podman0: 300 3 0 0 0 0 0 0 300 3 0 0 0 0 0 0
 wlan0: 200 2 0 0 0 0 0 0 100 1 0 0 0 0 0 0
`;

// /usr/sbin/netstat -ibn: en0 and en1 count; only <Link#N> rows have an interface's
// own counters, and rows without an address have one field fewer.
const NETSTAT = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                       9852253     0 4446143615  9852253     0 4446143615     0
lo0        16384 127           127.0.0.1        9852253     - 4446143615  9852253     - 4446143615     -
gif0*      1280  <Link#2>                             5     0         50        5     0         50     0
stf0*      1280  <Link#3>                             0     0          0        0     0          0     0
anpi0      1500  <Link#4>    ee:c1:b8:87:cb:f7        3     0         30        3     0         30     0
bridge0    1500  <Link#15>   36:cd:5e:37:06:40       10     0       1000       10     0       1000     0
ap1*       1500  <Link#13>   42:c1:1f:04:a5:38       10     0        700       10     0        700     0
en0        1500  <Link#14>   bc:d0:74:06:d1:e1       20     0       1000       10     0        500     0
en0        1500  192.168.1     192.168.1.58          20     -       1000       10     -        500     -
en1        1500  <Link#10>   36:cd:5e:37:06:40        3     0        300        2     0        200     0
awdl0      1500  <Link#16>   9a:6e:4b:71:cd:bb     3293     0    4327081      850     0     213470     0
utun4      1280  <Link#22>                      4540648     0 3898884893  3153600     0  456499920     0
utun4      1280  100.126.124.7 100.126.124.78   4540648     - 3898884893  3153600     -  456499920     -
vmenet0    1500  <Link#30>   aa:bb:cc:dd:ee:ff       10     0       9000       10     0       9000     0
`;

const EMPTY = "";
const GARBAGE = "hello world\nnot: a stat file\n1 2 3\n";

module.exports = { PROC_STAT_1, PROC_STAT_2, MEMINFO, VM_STAT, MEMSIZE, IOSTAT, NET_DEV, NETSTAT, EMPTY, GARBAGE };
