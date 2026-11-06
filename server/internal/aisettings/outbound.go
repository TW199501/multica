package aisettings

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/multica-ai/multica/server/pkg/remotemcp"
)

// allowCIDRsEnv names the operator's list of non-public ranges workspace AI
// endpoints may reach, such as a llama.cpp server on the LAN.
const allowCIDRsEnv = "MULTICA_AI_ALLOW_CIDRS"

// AllowCIDRsEnv is allowCIDRsEnv for the server's startup wiring.
const AllowCIDRsEnv = allowCIDRsEnv

var allowedPrefixes atomic.Pointer[[]netip.Prefix]

// SetAllowedPrefixes replaces the allow-list and reports entries it could not
// parse; the valid ones still apply.
func SetAllowedPrefixes(cidrs []string) []error {
	prefixes := make([]netip.Prefix, 0, len(cidrs))
	var errs []error
	for _, cidr := range cidrs {
		cidr = strings.TrimSpace(cidr)
		if cidr == "" {
			continue
		}
		prefix, err := netip.ParsePrefix(cidr)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s entry %q: %w", allowCIDRsEnv, cidr, err))
			continue
		}
		prefixes = append(prefixes, prefix)
	}
	allowedPrefixes.Store(&prefixes)
	return errs
}

// guardedDialCheck decides at connect time, so a hostname that resolves or
// redirects to a private address is refused like a literal one.
type guardedDialCheck struct{}

func (guardedDialCheck) check(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("invalid AI endpoint address %q: %w", address, err)
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return fmt.Errorf("invalid AI endpoint address %q: %w", address, err)
	}
	addr = addr.Unmap().WithZone("")
	if remotemcp.IsPublicAddress(addr) {
		return nil
	}
	if allowed := allowedPrefixes.Load(); allowed != nil {
		for _, prefix := range *allowed {
			if prefix.Contains(addr) {
				return nil
			}
		}
	}
	return fmt.Errorf("AI endpoint address %s is not public; the server operator can allow it with %s", addr, allowCIDRsEnv)
}

// guardedHTTPClient is shared so workspace clients reuse connections. It skips
// environment proxies, which would otherwise hide the real target from the check.
var guardedHTTPClient = newGuardedHTTPClient()

func newGuardedHTTPClient() *http.Client {
	check := guardedDialCheck{}
	dialer := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			return check.check(address)
		},
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = dialer.DialContext
	return &http.Client{Transport: transport}
}
